#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { CommandExecutor } from "./executor.js";
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export const log = {
  debug: (message: string, ...args: any[]) => {
    console.error(`[DEBUG] ${message}`, ...args);
  },
  info: (message: string, ...args: any[]) => {
    console.error(`[INFO] ${message}`, ...args);
  },
  warn: (message: string, ...args: any[]) => {
    console.error(`[WARN] ${message}`, ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  }
};

const commandExecutor = new CommandExecutor();

async function parseSshConfigAliases(): Promise<string[]> {
  const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
  let configContent = '';
  try {
    configContent = await fsPromises.readFile(sshConfigPath, 'utf8');
  } catch (error: any) {
    log.warn(`无法读取SSH配置文件 ${sshConfigPath}: ${error.message}`);
    return [];
  }

  const aliases: string[] = [];
  const lines = configContent.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const hostMatch = trimmedLine.match(/^host\s+([^\s*?!]+)/i);
    if (hostMatch && hostMatch[1]) {
      aliases.push(hostMatch[1]);
    }
  }
  return aliases;
}

async function createServer() {
  const server = new Server(
    {
      name: "terminal-mcp-server",
      version: "0.0.1",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const sshAliases = await parseSshConfigAliases();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const hostProperty: any = {
      type: "string",
      description: "Host to connect to (optional, if not provided the command will be executed locally)"
    };

    if (sshAliases.length > 0) {
      hostProperty.enum = sshAliases;
      hostProperty.description = "Host to connect to (optional, if not provided the command will be executed locally). Available SSH aliases: " + sshAliases.join(', ');
    }

    return {
      tools: [
        {
          name: "execute_command",
          description: "Execute commands on remote hosts or locally (This tool can be used for both remote hosts and the current machine)",
          inputSchema: {
            type: "object",
            properties: {
              host: hostProperty,
              command: {
                type: "string",
                description: "Command to execute. Before running commands, it's best to determine the system type (Mac, Linux, etc.)"
              },
              env: {
                type: "object",
                description: "Environment variables"
              }
            },
            required: ["command"]
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (request.params.name !== "execute_command") {
        throw new McpError(ErrorCode.MethodNotFound, "Unknown tool");
      }
      
      const host = request.params.arguments?.host ? String(request.params.arguments.host) : undefined;
      const command = String(request.params.arguments?.command);
      if (!command) {
        throw new McpError(ErrorCode.InvalidParams, "Command is required");
      }
      const env = request.params.arguments?.env || {};

      try {
        const result = await commandExecutor.executeCommand(command, {
          host,
          env: env as Record<string, string>
        });
        
        return {
          content: [{
            type: "text",
            text: `Command Output:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
          }]
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes('SSH')) {
          throw new McpError(
            ErrorCode.InternalError,
            `SSH connection error: ${error.message}. Please ensure SSH key-based authentication is set up.`
          );
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return server;
}

async function main() {
  try {
    const server = await createServer();
    
    server.onerror = (error) => {
      log.error(`MCP Error: ${error.message}`);
    };
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.info("Remote Ops MCP server running on stdio");

    process.on('SIGINT', async () => {
      log.info("Shutting down server...");
      await commandExecutor.disconnect();
      process.exit(0);
    });
  } catch (error) {
    log.error("Server error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  log.error("Server error:", error);
  process.exit(1);
});
