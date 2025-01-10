// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import OpenAI from "openai";
import fs from 'fs';
import * as vscode from 'vscode';
import dotenv from 'dotenv';
import path from 'path';
import { parseDocument } from "htmlparser2";
import serialize from "dom-serializer";
import ky, { Input } from "ky";
import sharp from "sharp";

let openai: OpenAI;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const envPath = path.join(context.extensionPath, '.env');
	dotenv.config({ path: envPath });
	openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

	// This line of code will only be executed once when your extension is activated
	console.log('Renew: Congratulations, your extension is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('renew.redesign', async () => {
		// The code you place here will be executed every time your command is executed
		vscode.window.showInformationMessage('Renew: Redesign is in progress...');
		await replaceContentInFiles();
		vscode.window.showInformationMessage('Renew: Redesign is complete');
	});
	context.subscriptions.push(disposable);
}

const replaceContentInFiles = async () => {

	const files = await vscode.workspace.findFiles('**/*.html', '**/node_modules/**');

	for (const file of files) {
		const document = await vscode.workspace.openTextDocument(file);
		const text = document.getText();

		// replace images
		const imgTags = text.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/g);
		const imageUrls = imgTags?.map(tag => tag.match(/src=["']([^"']+)["']/)[1]) || [];
		for (const imageUrl of imageUrls) {
			const imageFilePath = await getFilePathFromWorkspace(imageUrl);
			if (imageFilePath) {
				await replaceImage(imageFilePath);
			}
		}

		const updatedText = await replaceTextInHtml(text);

		const edit = new vscode.WorkspaceEdit();
		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		);
		edit.replace(file, fullRange, updatedText);
		await vscode.workspace.applyEdit(edit);

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
			return files[0].fsPath; // Return the absolute file path
		}
	} catch {
		vscode.window.showErrorMessage(`Renew: File "${fileName}" not found in workspace`);
		return undefined;
	}
}

const replaceImage = async (imageFilePath: string) => {

	const pngImageFilePath = replaceFileExtensionToPng(imageFilePath);
	await convertImageToPng(imageFilePath, pngImageFilePath);

	const response = await openai.images.createVariation({
		model: "dall-e-2",
		image: fs.createReadStream(pngImageFilePath),
		n: 1,
		size: "256x256"
	});

	const resp = await ky.get(response.data[0].url as Input);
	const newImage = await resp.arrayBuffer();

	const buffer = Buffer.from(newImage);
	fs.writeFileSync(pngImageFilePath, buffer);
};

async function convertImageToPng(inputPath: string, outputPath: string) {
	try {
		await sharp(inputPath)
			.png() // Convert to PNG
			.toBuffer({ resolveWithObject: true })
			.then(({ data, info }) => {
				if (info.size > 4 * 1024 * 1024) { // Check size
					return sharp(data)
						.resize({ width: Math.round(info.width * 0.9) }) // Resize proportionally
						.toFile(outputPath);
				} else {
					fs.writeFileSync(outputPath, data);
				}
			});
		console.log(`Image converted and saved to ${outputPath}`);
	} catch (error) {
		console.error('Error converting image:', error);
	}
}

function replaceFileExtensionToPng(filePath: string): string {
	const parsedPath = path.parse(filePath);
	const pngPath = path.format({
		...parsedPath,
		base: undefined,  // Need to remove base so ext and name are used
		ext: '.png'
	});
	return pngPath;
}

async function replaceTextInHtml(html: string): Promise<string> {
	const dom = parseDocument(html);

	const traverseTextNodes = async (node: any) => {
		if (node.type === 'text' && node.data.trim()) {
			const originalText = node.data.trim();
			console.log(originalText);
			const replacementText = await updateText(originalText);
			console.log(replacementText);
			node.data = node.data?.replace(originalText, replacementText);
		}
		if (node.children) {
			node.children.forEach(traverseTextNodes);
		}
	};

	dom.children.forEach(traverseTextNodes);

	return serialize(dom);
}

const updateText = async (text: string): Promise<any> => {
	if (text) {
		console.log("Calling textGeneration model");
		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			store: true,
			messages: [{ role: "system", content: "You are just rephrasing the given input, but make sure the input is human readable text, like sentences or phrases. Your answers are always less than 100 words." },
			{ role: "user", content: text }
			]
		});
		return completion.choices[0].message.content;
	} else {
		return "";
	}
};

export function deactivate() { }