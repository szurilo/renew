// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import OpenAI from "openai";
import fs from 'fs';
import * as vscode from 'vscode';
import dotenv from 'dotenv';
import path from 'path';
import { parseDocument } from "htmlparser2";
import serialize from "dom-serializer";
import sharp from "sharp";
import { randomUUID } from "crypto";

const PNG_MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB
const imageGenLimit = 0;
const textGenLimit = 10;
let openai: OpenAI;
let imageGenerations: number;
let textGenerations: number;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	const envPath = path.join(context.extensionPath, '.env');
	dotenv.config({ path: envPath });
	openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('renew.redesign', async () => {
		// The code you place here will be executed every time your command is executed
		vscode.window.showInformationMessage('Renew: Redesign is in progress...');
		imageGenerations = 0;
		textGenerations = 0;
		await replaceContentInFiles();
		vscode.window.showInformationMessage('Renew: Redesign is complete');
	});
	context.subscriptions.push(disposable);
}

const replaceContentInFiles = async () => {
	const files = await vscode.workspace.findFiles('**/*.html', '**/node_modules/**');

	for (const file of files) {
		const document = await vscode.workspace.openTextDocument(file);
		const documentText = document.getText();

		if (imageGenerations < imageGenLimit) {
			await replaceImages(documentText);
		}
		if (textGenerations < textGenLimit) {
			await replaceTexts(documentText, document, file);
		}
	}
};

const replaceImages = async (text: string) => {
	const imgTags = text.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/g);
	const imageUrls = imgTags?.map(tag => tag.match(/src=["']([^"']+)["']/)?.[1]) || [];
	for (const imageUrl of imageUrls) {
		const imageFilePath = await getFilePathFromWorkspace(imageUrl);
		if (imageFilePath) {
			if (imageGenerations >= imageGenLimit) {
				vscode.window.showInformationMessage('Renew: Image generation limit reached');
				console.log("Image generation limit reached");
				return;
			}
			imageGenerations++;
			await replaceImage(imageFilePath);
		}
	}
};

const getFilePathFromWorkspace = async (fileName: string | undefined): Promise<string | undefined> => {
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
};

const replaceImage = async (imageFilePath: string) => {
	const pngImageFilePath = replaceFileExtensionToPng(imageFilePath);
	await convertImageToPng(imageFilePath, pngImageFilePath);

	console.log("Calling imageGeneration model");
	const response = await openai.images.createVariation({
		model: "dall-e-2",
		image: fs.createReadStream(pngImageFilePath),
		n: 1,
		size: "256x256"
	});
	const { default: ky } = await import('ky');
	const resp = await ky.get(response.data[0].url!); // Add non-null assertion since we know URL exists
	const newImage = await resp.arrayBuffer();

	const buffer = Buffer.from(newImage);
	fs.writeFileSync(pngImageFilePath, buffer);
	console.log("Replacement image saved to " + pngImageFilePath);
};

const replaceFileExtensionToPng = (filePath: string): string => {
	const parsedPath = path.parse(filePath);
	const pngPath = path.format({
		...parsedPath,
		base: undefined,  // Need to remove base so ext and name are used
		ext: '.png'
	});
	return pngPath;
};

const convertImageToPng = async (inputPath: string, outputPath: string) => {
	try {
		await sharp(inputPath)
			.png() // Convert to PNG
			.toBuffer({ resolveWithObject: true })
			.then(async ({ data, info }) => {
				let currentData = data;
				let currentInfo = info;
				while (currentInfo.size > PNG_MAX_FILE_SIZE) { // Check size
					await sharp(currentData)
						.resize({ width: Math.round(currentInfo.width * 0.9) }) // Resize proportionally
						.toBuffer({ resolveWithObject: true })
						.then(({ data: resizedData, info: resizedInfo }) => {
							currentData = resizedData;
							currentInfo = resizedInfo;
						});
				}
				fs.writeFileSync(outputPath, currentData);
			});
		console.log(`Image converted and saved to ${outputPath}`);
	} catch (error) {
		console.error('Error converting image:', error);
	}
};

const replaceTexts = async (documentText: string, document: vscode.TextDocument, file: vscode.Uri) => {
	const updatedText = await replaceTextInHtml(documentText);

	const edit = new vscode.WorkspaceEdit();
	const fullRange = new vscode.Range(
		document.positionAt(0),
		document.positionAt(documentText.length)
	);
	edit.replace(file, fullRange, updatedText);
	await vscode.workspace.applyEdit(edit);
};

const replaceTextInHtml = async (html: string): Promise<string> => {
	const dom = parseDocument(html);
	for (const child of dom.children) {
		await traverseTextNodes(child);
	}
	return serialize(dom);
};

const traverseTextNodes = async (node: any): Promise<void> => {
	if (node.type === 'text' && node.data.trim()) {

		if (textGenerations >= textGenLimit) {
			vscode.window.showInformationMessage('Renew: Text generation limit reached');
			console.log("Text generation limit reached");
			return;
		}
		textGenerations++;

		const originalText = node.data.trim();
		const uuid = randomUUID();
		console.log("originalText_" + uuid + ": " + originalText);
		const replacementText = await replaceText(originalText);
		console.log("replacementText_" + uuid + ": " + replacementText);
		node.data = node.data?.replace(originalText, replacementText);
	}
	if (node.children) {
		for (const child of node.children) {
			await traverseTextNodes(child);
		}
	}
};

const replaceText = async (text: string): Promise<any> => {
	const completion = await openai.chat.completions.create({
		model: "gpt-4o-mini",
		store: true,
		messages: [{ role: "system", content: "You are just rephrasing the given input, but make sure the input is human readable text, like sentences or phrases. Your answers are always less than 100 words." },
		{ role: "user", content: text }
		]
	});
	return completion.choices[0].message.content;
};

export function deactivate() { }