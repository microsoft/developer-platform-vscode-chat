// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from 'dotenv';
import { join } from 'path';
import * as vscode from 'vscode';
import { initOutputChannel } from './common.js';
import { initAgent } from './devplat-agent.js';
import { initApiCaller } from './devplat-api.js';
import { handleTemplateCommand } from './input-flow.js';

export async function activate(context: vscode.ExtensionContext) {
    // bring in .env file
    dotenv.config({ path: join(context.extensionPath, '.env') });

    initOutputChannel(context);
    initApiCaller(context);
    initAgent(context);

    // Register commands
    vscode.commands.registerCommand('devplat-agent.fulfill-template', handleTemplateCommand);
}

export function deactivate() {}
