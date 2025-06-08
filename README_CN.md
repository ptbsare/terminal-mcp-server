# 终端 MCP 服务器

终端 MCP 服务器是一个模型上下文协议（MCP）服务器，旨在通过强大的 SSH 功能促进远程和本地命令执行。它允许您的 AI 模型或其他应用程序通过 SSH 或在本地安全地执行命令，提供了一种与各种系统交互的强大方式。

## 亮点

- **安全 SSH 命令执行**：使用 SSH 安全地在远程服务器上执行命令，支持 SSH 别名配置文件解析。自动解析您的 `~/.ssh/config` 文件以检索连接详细信息，如 HostName、User、IdentityFile、Passphrase 和 Port，从而简化 SSH 管理。
- **本地命令执行**：直接在运行 MCP 服务器的本地机器上运行命令。
- **会话管理与超时**：维护持久的 SSH 会话，具有可配置的超时时间，以实现高效的命令执行和资源管理。
- **环境变量支持**：将环境变量传递给远程和本地命令。
- **本地命令默认目录**：配置 `DEFAULT_DIR` 环境变量以指定本地命令执行的起始目录。

## 功能

- **远程命令执行**：通过 SSH 连接到远程主机并执行指定的命令。
- **本地命令执行**：在本地机器上执行命令。
- **SSH 配置解析**：读取和解释 `~/.ssh/config` 以简化连接设置。
- **连接池**：重用现有 SSH 连接以最大程度地减少开销。
- **错误处理和重试**：实现连接尝试的重试机制和强大的错误报告。

## 使用方法

### 安装

1.  **克隆仓库**：
    ```bash
    git clone https://github.com/ptbsare/terminal-mcp-server.git
    cd terminal-mcp-server
    ```
2.  **安装依赖**：
    ```bash
    npm install
    ```
3.  **构建项目**：
    ```bash
    npm run build
    ```

### 运行服务器

要启动 MCP 服务器：

```bash
npm start
```

服务器将监听传入的 MCP 请求。

### SSH 配置

确保您的 SSH 配置（`~/.ssh/config`）已正确设置您希望连接的主机。服务器将自动解析此文件。

示例 `~/.ssh/config`：

```
Host my_remote_server
  HostName your_remote_server_ip_or_hostname
  User your_username
  IdentityFile ~/.ssh/id_rsa
  Port 22
  # Passphrase your_passphrase (如果您的密钥已加密，请取消注释并设置)
```

### 与 Claude（或其他 AI 模型）一起使用

要将此 MCP 服务器与 Claude 集成，您需要配置 Claude 以连接到本地 MCP 服务器。

1.  如上所述**启动终端 MCP 服务器**。
2.  **配置 Claude**：在您的 Claude 环境中，您通常会创建一个 JSON 文件（例如，`mcp_server.json`），其结构如下：

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

    此服务器提供一个工具：`execute_command`。

    **工具：`execute_command`**
    - **描述**：在远程主机上通过 SSH 或在本地执行 shell 命令。
    - **参数**：
        - `command` (字符串，必需)：要执行的 shell 命令。
        - `host` (字符串，可选)：要执行命令的 SSH 主机别名（来自您的 `~/.ssh/config`）。如果未提供，命令将在本地执行。
        - `env` (对象，可选)：为命令执行设置的环境变量。键和值应为字符串。

    将此 JSON 内容保存为 `mcp_server.json`（或任何其他名称），并将其提供给 Claude 的 MCP 配置。提供此配置的确切方法取决于您的 Claude 环境（例如，通过特定的 UI、API 调用或配置文件）。

### 本地命令默认目录

您可以在启动 `terminal-mcp-server` 之前设置环境变量 `DEFAULT_DIR`，以指定本地命令的默认工作目录。

示例：

```bash
DEFAULT_DIR="/workdir" npm start
```

这将使通过 MCP 服务器执行的所有本地命令都从 `/workdir` 开始，除非明确覆盖。