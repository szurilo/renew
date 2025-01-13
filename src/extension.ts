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
let imageGenLimit: number;
let textGenLimit: number;
let openai: OpenAI;
let imageGenerations: number;
let textGenerations: number;
let globalProgress: vscode.Progress<{ message?: string; increment?: number; }>;

export async function activate(context: vscode.ExtensionContext) {
	const envPath = path.join(context.extensionPath, '.env');
	dotenv.config({ path: envPath });
	openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
	imageGenLimit = process.env.IMAGE_GEN_LIMIT ? parseInt(process.env.IMAGE_GEN_LIMIT) : 3;
	textGenLimit = process.env.TEXT_GEN_LIMIT ? parseInt(process.env.TEXT_GEN_LIMIT) : 30;

	const disposable = vscode.commands.registerCommand('renew.redesign', async () => {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: true
		}, async (progress, token) => {
			token.onCancellationRequested(() => {
				console.log("User canceled the long running operation");
			});
			globalProgress = progress;
			imageGenerations = 0;
			textGenerations = 0;
			await replaceContentInFiles(progress);
			if (textGenerations >= textGenLimit) {
				vscode.window.showInformationMessage("Renew: Text generation limit reached.\n Redesign is complete");
				console.log("Text generation limit reached");
				return;
			}
			if (imageGenerations >= imageGenLimit) {
				vscode.window.showInformationMessage("Renew: Image generation limit reached.\n Redesign is complete");
				console.log("Image generation limit reached");
				return;
			}
			vscode.window.showInformationMessage("Renew: Redesign is complete");
			return;
		});
	});
	context.subscriptions.push(disposable);
}

const replaceContentInFiles = async (progress: vscode.Progress<{ message?: string; increment?: number; }>) => {
	const files = await vscode.workspace.findFiles('**/*.html', '**/node_modules/**');

	for (const file of files) {
		progress.report({ increment: 100 / files.length, message: "Redesigning: " + file.path });
		const document = await vscode.workspace.openTextDocument(file);
		const documentText = document.getText();

		if (imageGenerations < imageGenLimit || textGenerations < textGenLimit) {
			await replaceTextsAndImages(documentText, document, file);
		}
	}
};

const replaceTextsAndImages = async (documentText: string, document: vscode.TextDocument, file: vscode.Uri) => {
	const updatedText = await replaceTextsAndImagesInHtml(documentText);

	const edit = new vscode.WorkspaceEdit();
	const fullRange = new vscode.Range(
		document.positionAt(0),
		document.positionAt(documentText.length)
	);
	edit.replace(file, fullRange, updatedText);
	await vscode.workspace.applyEdit(edit);
};

const replaceTextsAndImagesInHtml = async (html: string): Promise<string> => {
	const dom = parseDocument(html);
	for (const child of dom.children) {
		await traverseNodes(child);
	}
	return serialize(dom);
};

const traverseNodes = async (node: any): Promise<void> => {
	if (node.type === 'tag' && node.name === 'img') {
		const srcAttribute = node.attribs?.src;
		if (srcAttribute) {
			const imageFilePath = await getFilePathFromWorkspace(srcAttribute);
			if (!imageFilePath) {
				return;
			}
			if (imageGenerations >= imageGenLimit) {
				return;
			}
			imageGenerations++;

			await replaceImage(imageFilePath);
			node.attribs.src = replaceFileExtensionToPng(srcAttribute);
		}
	}
	if (node.type === 'text' && node.data.trim()) {

		if (textGenerations >= textGenLimit) {
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
			await traverseNodes(child);
		}
	}
};

const replaceImage = async (imageFilePath: string): Promise<string | null> => {
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
	const resp = await ky.get(response.data[0].url!);
	const newImage = await resp.arrayBuffer();

	const buffer = Buffer.from(newImage);
	fs.writeFileSync(pngImageFilePath, buffer);
	console.log("Replacement image saved to " + pngImageFilePath);
	return pngImageFilePath;
};

const getFilePathFromWorkspace = async (fileName: string | undefined): Promise<string | undefined> => {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders) {
		vscode.window.showErrorMessage("Renew: No workspace folder open");
		return;
	}

	const files = await vscode.workspace.findFiles('**/' + fileName, '**/node_modules/**');
	try {
		const stat = await vscode.workspace.fs.stat(files[0]);
		if (stat) {
			return files[0].fsPath; // Return the absolute file path
		}
	} catch {
		vscode.window.showErrorMessage(`Renew: File "${fileName}" not found in workspace`);
		return;
	}
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

const replaceText = async (text: string): Promise<string | null> => {
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