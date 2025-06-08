# Terminal MCP Server

The Terminal MCP Server is a Model Context Protocol (MCP) server designed to facilitate remote and local command execution, with robust SSH capabilities. It allows your AI models or other applications to securely execute commands on remote hosts via SSH or locally, providing a powerful way to interact with various systems.

## Highlights

- **Secure SSH Command Execution**: Execute commands on remote servers securely using SSH, with support for SSH alias config file parsing. Automatically parses your `~/.ssh/config` file to retrieve connection details like HostName, User, IdentityFile, Passphrase, and Port, simplifying SSH management.
- **Local Command Execution**: Run commands directly on the local machine where the MCP server is running.
- **Session Management with Timeout**: Maintains persistent SSH sessions with configurable timeouts for efficient command execution and resource management.
- **Environment Variable Support**: Pass environment variables to both remote and local commands.
- **Default Directory for Local Commands**: Configure a `DEFAULT_DIR` environment variable to specify the starting directory for local command execution.

## Features

- **Remote Command Execution**: Connects to remote hosts via SSH and executes specified commands.
- **Local Command Execution**: Executes commands on the local machine.
- **SSH Configuration Parsing**: Reads and interprets `~/.ssh/config` for streamlined connection setup.
- **Connection Pooling**: Reuses existing SSH connections to minimize overhead.
- **Error Handling and Retries**: Implements retry mechanisms for connection attempts and robust error reporting.

## Usage

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/ptbsare/terminal-mcp-server.git
    cd terminal-mcp-server
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Build the project**:
    ```bash
    npm run build
    ```

### Running the Server

To start the MCP server:

```bash
npm start
```

The server will listen for incoming MCP requests.

### SSH Configuration

Ensure your SSH configuration (`~/.ssh/config`) is set up correctly for the hosts you wish to connect to. The server will automatically parse this file.

Example `~/.ssh/config`:

```
Host my_remote_server
  HostName your_remote_server_ip_or_hostname
  User your_username
  IdentityFile ~/.ssh/id_rsa
  Port 22
  # Passphrase your_passphrase (uncomment and set if your key is encrypted)
```

### Using with Claude (or other AI models)

To integrate this MCP server with Claude, you need to configure Claude to connect to a local MCP server.

1.  **Start the Terminal MCP Server** as described above.
2.  **Configure Claude**: In your Claude environment, you will typically add a tool definition that points to this MCP server. The exact configuration steps depend on the Claude interface or API you are using.

    To configure the MCP server for Claude, you would typically create a JSON file (e.g., `mcp_server.json`) with the following structure:

    ```json
    {
      "mcpServers": {
        "terminal-mcp-server": {
          "command": "npm",
          "args": [
            "--prefix",
            "/path/to/terminal-mcp-server",
            "run",
            "start"
          ]
        }
      }
    }
    ```

    This server provides a single tool: `execute_command`.

    **Tool: `execute_command`**
    - **Description**: Executes a shell command on a remote host via SSH or locally.
    - **Parameters**:
        - `command` (string, required): The shell command to execute.
        - `host` (string, optional): The SSH host alias from your `~/.ssh/config` to execute the command on. If not provided, the command will be executed locally.
        - `env` (object, optional): Environment variables to set for the command execution. Keys and values should be strings.

    Save this JSON content as `mcp_server.json` (or any other name) and provide it to Claude's MCP configuration. The exact method for providing this configuration depends on your Claude environment (e.g., via a specific UI, API call, or configuration file).

### Local Command Default Directory

You can set an environment variable `DEFAULT_DIR` before starting the `terminal-mcp-server` to specify the default working directory for local commands.

Example:

```bash
DEFAULT_DIR="/workdir" npm start
```

This will make all local commands executed via the MCP server start in `/workdir` unless explicitly overridden.