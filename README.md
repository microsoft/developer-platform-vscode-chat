# Developer Platform Chat Agent for VS Code

This extension illustrates how an extension can register a `@devplat` chat agent that helps a user create find and use a developer platform template in VS Code and access the Copilot LLM in the chat agent handler.

The contributes a `/template` and `/fulfill` command to find and fulfill a template. In addition, you can just send a message to `@devplat` and it will attempt to resolve a slash command and parameters.

The extension uses VS Code proposed API which is subject to change until finalization. Please review all the proposals in the [typings](./src/typings) directory.

## Development

1. `npm install`
2. Start up VS Code Insiders
3. Install the pre-release of Copilot Chat
4. `F5` to start debugging

## Usage

> **Note: this extension sample requires VS Code 1.83.0 or newer.**

1. Fully shut down VS Code Insiders, then run `code-insiders --enable-proposed-api ms-vscode.developer-platform-vscode-chat`
2. Download the VSIX from [Releases](https://github.com/microsoft/developer-platform-vscode-chat/releases), install in VS Code Insiders
3. Ensure you are on the pre-release of Copilot Chat
4. Sign into the Internal Developer Platform if prompted (once per machine).
5. Grant permissions to wire up the Internal Developer Platform if prompted (once per account).
6. Open the chat view and type `@devplat` to get started.

This may also work in stable VS Code, but I haven't been testing there so far.

Example commands to try:

| Prompt                                        | Note                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@devplat find me a template that says hello` | Automatically converts to the `/template` slash command and related input.                                                                  |
| `@devplat /template hello`                    | Slash command that resolves to the same output as the previous example.                                                                     |
| `@devplat fulfill the hello template`         | Triggers fulfillment of the "Say Hello" template. This example generally falls back to using Copilot to try to match the template template. |
| `@devplat /fulfill hello`                     | Shortcut to previous                                                                                                                        |

You can the steps that the extension went through in the `Dev Platform` output in VS Code.

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
