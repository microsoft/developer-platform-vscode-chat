// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';

export async function handleTemplateCommand() {
    const pick = vscode.window.createQuickPick();
    pick.title = 'Search for a template';
    pick.placeholder = 'Enter some text on what you are looking to do';
    pick.onDidChangeValue(async value => {
        // Get a cancellation token for VS Code
    });
}
