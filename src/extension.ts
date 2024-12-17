// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { HfInference } from "@huggingface/inference";
import fs, { readFileSync } from 'fs';
import * as vscode from 'vscode';
import dotenv from 'dotenv';
import path from 'path';

let inference: HfInference | null = null;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const envPath = path.join(context.extensionPath, '.env');
	dotenv.config({ path: envPath });
	inference = new HfInference(process.env.HF_TOKEN);

	// This line of code will only be executed once when your extension is activated
	console.log('Renew: Congratulations, your extension is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('renew.redesign', async () => {
		// The code you place here will be executed every time your command is executed
		vscode.window.showInformationMessage('Renew: Redesign is in progress');
		await replaceContentInFiles();
		vscode.window.showInformationMessage('Renew: Redesign is complete');
	});
	context.subscriptions.push(disposable);
}

const replaceContentInFiles = async () => {

	const files = await vscode.workspace.findFiles('**/*.svelte', '**/node_modules/**');

	for (const file of files) {
		const document = await vscode.workspace.openTextDocument(file);
		const text = document.getText();
		let updatedText = "";

		// replace images
		const imgTags = text.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/g);
		const imageUrls = imgTags?.map(tag => tag.match(/src=["']([^"']+)["']/)[1]) || [];
		for (const imageUrl of imageUrls) {
			const imageFilePath = await getFilePathFromWorkspace(imageUrl);
			if (imageFilePath) {
				await replaceImage(imageFilePath);
			}
		}

		// replace texts
		// updatedText = text.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/g, `<img src="${result}" />`);
		// if (updatedText) {
		// 	const edit = new vscode.WorkspaceEdit();
		// 	const fullRange = new vscode.Range(
		// 		document.positionAt(0),
		// 		document.positionAt(text.length)
		// 	);
		// 	edit.replace(file, fullRange, updatedText);
		// 	await vscode.workspace.applyEdit(edit);
		// }
	}
	return;
};

export async function getFilePathFromWorkspace(fileName: string): Promise<string | undefined> {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders) {
		vscode.window.showErrorMessage("Renew: No workspace folder open");
		return undefined;
	}

	const files = await vscode.workspace.findFiles('**/' + fileName, '**/node_modules/**');
	try {
		const stat = await vscode.workspace.fs.stat(files[0]);
		if (stat) {
			return files[0].fsPath; // Return the file path
		}
	} catch {
		vscode.window.showErrorMessage(`Renew: File "${fileName}" not found in workspace`);
		return undefined;
	}
}

const replaceImage = async (imageFilePath: string) => {
	try {
		const imageToTextResponse = await inference.imageToText({
			data: readFileSync(imageFilePath),
			model: "Salesforce/blip-image-captioning-large",
			options: {
				wait_for_model: true
			}
		});

		const textToImageResponse = await inference.textToImage({
			model: "black-forest-labs/FLUX.1-dev",
			inputs: imageToTextResponse.generated_text,
		});

		const buffer = Buffer.from(await textToImageResponse.arrayBuffer());
		fs.writeFileSync(imageFilePath, buffer);

	} catch (error) {
		throw error; // rethrow the error so it can be caught by the caller
	}
};

// This method is called when your extension is deactivated
export function deactivate() { }