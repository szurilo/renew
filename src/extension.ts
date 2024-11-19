// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "renew" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('renew.redesign', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Renew: Redesign is in progress');
		/*************  ✨ Codeium Command ⭐  *************/
		const replaceImagesInHtmlFiles = async () => {
			const htmlFiles = await vscode.workspace.findFiles('**/*.html', '**/node_modules/**');
			const newImageUrl = 'https://images.squarespace-cdn.com/content/v1/57879a6cbebafb879f256735/1712832754805-I7IJ7FRXF629FN3PIS3O/KC310124-27.jpg'; // replace with your desired image URL

			for (const file of htmlFiles) {
				const document = await vscode.workspace.openTextDocument(file);
				const text = document.getText();
				const updatedText = text.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/g, `<img src="${newImageUrl}" />`);

				const edit = new vscode.WorkspaceEdit();
				const fullRange = new vscode.Range(
					document.positionAt(0),
					document.positionAt(text.length)
				);
				edit.replace(file, fullRange, updatedText);
				await vscode.workspace.applyEdit(edit);
			}

			vscode.window.showInformationMessage('All images in HTML files have been replaced!');
		};

		replaceImagesInHtmlFiles();
		/******  439d9685-77bb-4fa1-afb9-93a25b1c3cc3  *******/
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
