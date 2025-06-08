import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { log } from './index.js';
import * as fsPromises from 'fs/promises';
import SSHConfig from 'ssh-config';

export class CommandExecutor {
  private sessions: Map<string, {
    client: Client | null;
    connection: Promise<void> | null;
    timeout: NodeJS.Timeout | null;
    host?: string;
    env?: Record<string, string>;
  }> = new Map();
  
  private sessionTimeout: number = 20 * 60 * 1000;
  private maxRetries: number = 3;
  private retryDelayMs: number = 2000;

  constructor() {}

  private getSessionKey(host: string | undefined): string {
    return `${host || 'local'}`;
  }

  async connect(hostAlias: string): Promise<void> {
    const sessionKey = this.getSessionKey(hostAlias);
    const session = this.sessions.get(sessionKey);
    
    if (session?.connection && session?.client) {
      if (session.client.listenerCount('ready') > 0 || session.client.listenerCount('data') > 0) {
        log.info(`Reusing existing session: ${sessionKey}`);
        return session.connection;
      }
      log.info(`Session ${sessionKey} disconnected, creating new session`);
      this.sessions.delete(sessionKey);
    }

    let privateKey: Buffer;
    let privateKeyPath: string;
    let passphrase: string | undefined;
    let port: number | undefined;

    try {
      const sshConfig = await this.parseSshConfig(hostAlias);
      const actualHost = sshConfig.hostname || hostAlias;
      let actualUsername = sshConfig.user;
      privateKeyPath = sshConfig.identityFile || path.join(os.homedir(), '.ssh', 'id_rsa');
      passphrase = sshConfig.passphrase;
      port = sshConfig.port;

      log.info(`Parsed SSH config for alias "${hostAlias}": Hostname=${sshConfig.hostname}, User=${sshConfig.user}, IdentityFile=${sshConfig.identityFile}, Passphrase=${sshConfig.passphrase ? '[PRESENT]' : '[ABSENT]'}, Port=${sshConfig.port}`);


      if (!actualUsername) {
        log.warn(`Username not found in SSH config for alias "${hostAlias}". Defaulting to "root".`);
        actualUsername = 'root';
      }

      for (let i = 0; i < this.maxRetries; i++) {
        try {
          privateKey = fs.readFileSync(privateKeyPath);
          log.info(`Successfully read private key from: ${privateKeyPath}`);
        } catch (error: any) {
          log.info(`Error reading private key from ${privateKeyPath}:`, error);
          if (error.code === 'ENOENT') {
            throw new Error(`SSH key file (${privateKeyPath}) does not exist. Please ensure SSH key-based authentication is set up.`);
          } else if (error.message.includes('unsupported format') || error.message.includes('Cannot parse privateKey')) {
            throw new Error(`Unsupported SSH key format for key at ${privateKeyPath}: ${error.message}. If your key is encrypted, ensure "passphrase" is provided in your SSH config or the key is not encrypted.`);
          }
          throw new Error(`Failed to read SSH private key from ${privateKeyPath}: ${error.message}`);
        }

        const client = new Client();
        const connectionConfig = {
          host: actualHost,
          port: port,
          username: actualUsername,
          privateKey: privateKey,
          passphrase: passphrase,
          keepaliveInterval: 60000,
          timeout: 10000,
        };
        log.info(`Attempting SSH connection to ${actualHost} with config: ${JSON.stringify({ ...connectionConfig, privateKey: '[BUFFER]', passphrase: passphrase ? '[PRESENT]' : '[ABSENT]' })}`);

        const connection = new Promise<void>((resolve, reject) => {
          client
            .on('ready', () => {
              log.info(`Session ${sessionKey} connected to ${actualHost}`);
              this.resetTimeout(sessionKey);
              resolve();
            })
            .on('error', (err) => {
              log.error(`会话 ${sessionKey} 连接错误:`, err.message);
              reject(err);
            })
            .connect(connectionConfig);
        });

        try {
          await connection;
          log.info(`Creating new session: ${sessionKey}`);
          this.sessions.set(sessionKey, {
            client,
            connection,
            timeout: null,
            host: actualHost,
          });
          return;
        } catch (error: any) {
          log.warn(`Connection attempt ${i + 1}/${this.maxRetries} failed for ${sessionKey}: ${error.message}`);
          if (i < this.maxRetries - 1) {
            await new Promise(res => setTimeout(res, this.retryDelayMs));
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      throw error;
    }
  }

  private resetTimeout(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    if (session.timeout) {
      clearTimeout(session.timeout);
    }

    session.timeout = setTimeout(async () => {
      log.info(`Session ${sessionKey} timeout, disconnecting`);
      await this.disconnectSession(sessionKey);
    }, this.sessionTimeout);

    this.sessions.set(sessionKey, session);
  }

  private async isConnectionActive(client: Client): Promise<boolean> {
    return new Promise(resolve => {
      if (!client) {
        return resolve(false);
      }
      client.exec('echo "ping"', (err, stream) => {
        if (err) {
          log.info(`Connection check failed: ${err.message}`);
          return resolve(false);
        }
        let stdout = '';
        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        }).on('close', () => {
          resolve(stdout.trim() === 'ping');
        }).on('error', (streamErr: Error) => {
          log.info(`Stream error during connection check: ${streamErr.message}`);
          resolve(false);
        });
      });
    });
  }

  async executeCommand(
    command: string,
    options: {
      host?: string;
      env?: Record<string, string>;
    } = {}
  ): Promise<{stdout: string; stderr: string}> {
    const { host, env = {} } = options;
    const sessionKey = this.getSessionKey(host);

    if (host) {
      let sessionData = this.sessions.get(sessionKey);
      
      let needNewConnection = false;
      if (!sessionData || sessionData.host !== host || !sessionData.client || !(await this.isConnectionActive(sessionData.client))) {
        log.info(`Existing session ${sessionKey} is not active or host changed. Need new connection.`);
        needNewConnection = true;
      }
      
      if (needNewConnection) {
        log.info(`Creating new connection for command execution: ${sessionKey}`);
        await this.connect(host);
        sessionData = this.sessions.get(sessionKey);
      } else {
        log.info(`Reusing existing session for command execution: ${sessionKey}`);
      }
      
      if (!sessionData || !sessionData.client) {
        throw new Error(`无法创建到 ${host} 的SSH会话`);
      }
      
      this.resetTimeout(sessionKey);

      log.info(`Executing command using exec: ${command}`);
      return new Promise((resolve, reject) => {
        const envSetup = Object.entries(env)
          .map(([key, value]) => `export ${key}="${String(value).replace(/"/g, '\\"')}"` || '')
          .join(' && ');
        
        const fullCommand = envSetup ? `${envSetup} && ${command}` : command;
        
        sessionData?.client?.exec(`/bin/bash --login -c "${fullCommand.replace(/"/g, '\\"')}"`, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }

          let stdout = "";
          let stderr = '';
          stream
            .on("data", (data: Buffer) => {
              this.resetTimeout(sessionKey);
              stdout += data.toString();
            })
            .stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            })
            .on('close', () => {
              resolve({ stdout, stderr });
            })
            .on('error', (err) => {
              reject(err);
            });
        });
      });
    } 
    else {
      log.info(`Executing command using local session: ${sessionKey}`);
      
      let sessionData = this.sessions.get(sessionKey);
      let sessionEnv = {};
      
      if (!sessionData) {
        sessionData = {
          client: null,
          connection: null,
          timeout: null,
          host: undefined,
          env: { ...env }
        };
        this.sessions.set(sessionKey, sessionData);
        log.info(`Creating new local local session: ${sessionKey}`);
        sessionEnv = env;
      } else {
        log.info(`Reusing existing local session: ${sessionKey}`);
        if (!sessionData.env) {
          sessionData.env = {};
        }
        sessionData.env = { ...sessionData.env, ...env };
        sessionEnv = sessionData.env;
        this.sessions.set(sessionKey, sessionData);
      }
      
      this.resetTimeout(sessionKey);
      
      return new Promise((resolve, reject) => {
        const envVars = { ...process.env, ...sessionEnv };
        const defaultDir = process.env.DEFAULT_DIR as string | undefined;

        log.info(`Executing local command: ${command}${defaultDir ? ` in directory: ${defaultDir}` : ''}`);
        exec(command, { env: envVars, cwd: defaultDir }, (error, stdout, stderr) => {
          if (error && error.code !== 0) {
            resolve({ stdout, stderr: stderr || error.message });
          } else {
            resolve({ stdout, stderr });
          }
        });
      });
    }
  }

  private async disconnectSession(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (session) {
      if (session.client) {
        log.info(`Disconnecting SSH connection for session ${sessionKey}`);
        session.client.end();
      }
      if (session.timeout) {
        clearTimeout(session.timeout);
      }
      log.info(`Disconnecting session: ${sessionKey}`);
      this.sessions.delete(sessionKey);
    }
  }

  async disconnect(): Promise<void> {
    const disconnectPromises = Array.from(this.sessions.keys()).map(
      sessionKey => this.disconnectSession(sessionKey)
    );
    
    await Promise.all(disconnectPromises);
    this.sessions.clear();
  }

  private async parseSshConfig(alias: string): Promise<{ hostname?: string; user?: string; identityFile?: string; passphrase?: string; port?: number }> {
    const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
    let configContent = '';
    try {
      configContent = await fsPromises.readFile(sshConfigPath, 'utf8');
    } catch (error: any) {
      log.warn(`无法读取SSH配置文件 ${sshConfigPath}: ${error.message}`);
      return {};
    }

    try {
      const config = SSHConfig.parse(configContent);
      const hostConfig = config.find({ Host: alias });

      if (hostConfig) {
        const parsed: { hostname?: string; user?: string; identityFile?: string; passphrase?: string; port?: number } = {};
        hostConfig.config.forEach((item: any) => {
          const key = item.param.toLowerCase();
          const value = item.value;
          if (key === 'hostname') {
            parsed.hostname = value;
          } else if (key === 'user') {
            parsed.user = value;
          } else if (key === 'identityfile') {
            parsed.identityFile = value;
          } else if (key === 'passphrase') {
            parsed.passphrase = value;
          } else if (key === 'port') {
            parsed.port = parseInt(value, 10);
          }
        });
        log.info(`Parsed SSH config for alias "${alias}" using ssh-config: ${JSON.stringify(parsed)}`);
        return parsed;
      } else {
        log.info(`No matching host config found for alias "${alias}" in SSH config.`);
        return {};
      }
    } catch (error: any) {
      log.error(`Error parsing SSH config with ssh-config library: ${error.message}`);
      return {};
    }
  }
}