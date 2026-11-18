import * as path from 'node:path';
import * as vscode from 'vscode';
import { gridData, renderGrid, type GridColumn } from './grid';
import { deleteResource, findResourceFamily, listResourceFiles, readResx, setResource, sortResources } from './resx';
import { createResourceFiles } from './scaffold';
import type { XmlEdit } from './xml';

interface OpenColumn extends GridColumn {
	document: vscode.TextDocument;
	xml: string;
	version: number;
}

type GridChange =
	| { type: 'set'; key: string; file: string; value: string }
	| { type: 'add'; key: string; values: { file: string; value: string }[] }
	| { type: 'delete'; key: string }
	| { type: 'sort' | 'save' };

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function siblingNames(folder: vscode.Uri): Promise<string[]> {
	const siblings = await vscode.workspace.fs.readDirectory(folder);
	return siblings.filter(([, type]) => type & vscode.FileType.File).map(([name]) => name);
}

async function openColumns(folder: vscode.Uri, family: string): Promise<OpenColumn[]> {
	const files = listResourceFiles(family, await siblingNames(folder));
	return Promise.all(files.map(async file => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, file.fileName));
		const xml = document.getText();
		const column = { ...file, document, xml, version: document.version };
		try {
			return { ...column, resource: readResx(xml) };
		} catch (error) {
			return { ...column, error: errorText(error) };
		}
	}));
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readChange(message: Record<string, unknown>): GridChange {
	const { type, key, file, value, values } = message;
	if (type === 'sort' || type === 'save') {
		return { type };
	}
	if (typeof key !== 'string' || !key.trim()) {
		throw new Error('Enter a resource key.');
	}
	if (type === 'delete') {
		return { type, key };
	}
	if (type === 'set' && typeof file === 'string' && typeof value === 'string') {
		return { type, key, file, value };
	}
	if (type === 'add' && Array.isArray(values) && values.length &&
		values.every(entry => object(entry) && typeof entry.file === 'string' &&
			typeof entry.value === 'string' && entry.value !== '')) {
		return { type, key, values };
	}
	throw new Error('Enter at least one resource value.');
}

function sameResources(first: OpenColumn[], second: OpenColumn[]): boolean {
	return first.length === second.length && first.every((column, index) => {
		const current = second[index];
		return column.fileName === current.fileName && column.xml === current.xml;
	});
}

async function applyGridChange(columns: OpenColumn[], change: GridChange): Promise<string> {
	if (change.type === 'save') {
		const unsaved: string[] = [];
		let saved = 0;
		for (const { document, fileName } of columns) {
			if (document.isDirty) {
				if (await document.save()) {
					saved++;
				} else {
					unsaved.push(fileName);
				}
			}
		}
		if (unsaved.length) {
			throw new Error('Could not save ' + unsaved.join(', ') + '.');
		}
		return saved ? `Saved ${saved} ${saved === 1 ? 'file' : 'files'}.` : 'No changes to save.';
	}

	if (!columns.length || columns.some(column => !column.resource)) {
		throw new Error('Fix the invalid RESX files before making changes in the grid.');
	}
	if (change.type === 'add' && columns.some(column => column.resource!.entries.has(change.key))) {
		throw new Error(`"${change.key}" already exists in this resource family.`);
	}

	const values = new Map<string, string>();
	if (change.type === 'add') {
		for (const { file, value } of change.values) {
			values.set(file, value);
		}
	} else if (change.type === 'set') {
		values.set(change.file, change.value);
	}
	if ([...values.keys()].some(file => !columns.some(column => column.fileName === file))) {
		throw new Error('A target file is no longer part of this resource family.');
	}

	const edit = new vscode.WorkspaceEdit();
	for (const { document, xml, resource, fileName, version } of columns) {
		if (document.isClosed || document.version !== version) {
			throw new Error('Resources changed. Reopen the action to use the latest values.');
		}
		let changes: XmlEdit[] = [];
		const value = values.get(fileName);
		if (value !== undefined && (change.type === 'add' || change.type === 'set')) {
			changes = setResource(xml, resource!, change.key, value);
		} else if (change.type === 'delete') {
			changes = deleteResource(xml, resource!, change.key);
		} else if (change.type === 'sort') {
			changes = sortResources(xml, resource!);
		}
		for (const { start, end, text } of changes) {
			edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
		}
	}
	if (!edit.size) {
		return change.type === 'sort' ? 'The files are already sorted.' : 'No changes to apply.';
	}
	if (!await vscode.workspace.applyEdit(edit)) {
		throw new Error('VS Code could not apply the resource edits.');
	}
	return 'Changes applied. Use Save files to write them to disk.';
}

function attachGrid(panel: vscode.WebviewPanel, folder: vscode.Uri, family: string, media: vscode.Uri) {
	let columns: OpenColumn[] = [];
	let revision = 0;
	let disposed = false;
	let ready = false;
	let queue = Promise.resolve();
	let timer: NodeJS.Timeout | undefined;
	const writable = vscode.workspace.fs.isWritableFileSystem(folder.scheme) === true;
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '*.resx'));

	async function post(message: object) {
		if (ready && !disposed) {
			await panel.webview.postMessage(message);
		}
	}
	async function publish(next: OpenColumn[]) {
		if (!sameResources(columns, next)) {
			revision++;
		}
		columns = next;
		await post({
			type: 'state', revision, ...gridData(columns),
			editable: writable && columns.length > 0 && columns.every(column => column.resource),
			canSave: writable && columns.some(column => column.document.isDirty),
		});
	}
	function enqueue(operation: () => Promise<void>) {
		queue = queue.then(async () => {
			if (!disposed) {
				await operation();
			}
		}).catch(error => post({ type: 'result', error: errorText(error) }));
	}
	function refresh() {
		enqueue(async () => publish(await openColumns(folder, family)));
	}
	function changed(uri: vscode.Uri) {
		const name = path.posix.basename(uri.path);
		if (vscode.Uri.joinPath(uri, '..').toString() !== folder.toString() ||
			!name.endsWith('.resx') || !name.startsWith(family + '.')) {
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(refresh, 120);
	}
	const subscriptions = [
		watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed),
		vscode.workspace.onDidChangeTextDocument(event => changed(event.document.uri)),
		vscode.workspace.onDidSaveTextDocument(document => changed(document.uri)),
		panel.webview.onDidReceiveMessage((input: unknown) => {
			if (!object(input)) {
				return;
			}
			if (input.type === 'ready') {
				ready = true;
				refresh();
				return;
			}
			enqueue(async () => {
				if (!writable) {
					throw new Error('This resource family is read-only.');
				}
				const change = readChange(input);
				const latest = await openColumns(folder, family);
				if (change.type !== 'save' && (input.revision !== revision || !sameResources(columns, latest))) {
					await publish(latest);
					throw new Error('Resources changed. Reopen the action to use the latest values.');
				}
				const message = await applyGridChange(latest, change);
				await publish(await openColumns(folder, family));
				await post({ type: 'result', message });
			});
		}),
	];
	panel.onDidDispose(() => {
		disposed = true;
		clearTimeout(timer);
		for (const subscription of subscriptions) {
			subscription.dispose();
		}
	});
	const asset = (name: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, name)).toString();
	panel.webview.html = renderGrid(family, asset('grid.css'), asset('grid.js'), panel.webview.cspSource);
	return { panel, refresh };
}

export function activate(context: vscode.ExtensionContext) {
	const panels = new Map<string, ReturnType<typeof attachGrid>>();
	const media = vscode.Uri.joinPath(context.extensionUri, 'media');
	context.subscriptions.push(vscode.commands.registerCommand('netresx.createResourceFiles', createResourceFiles));

	context.subscriptions.push(vscode.commands.registerCommand('netresx.openTranslationGrid', async (uri?: vscode.Uri) => {
		const resource = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!resource?.path.endsWith('.resx') || vscode.workspace.fs.isWritableFileSystem(resource.scheme) === undefined) {
			void vscode.window.showInformationMessage('Open a .resx file to view its resource grid.');
			return;
		}
		try {
			const folder = vscode.Uri.joinPath(resource, '..');
			const family = findResourceFamily(path.posix.basename(resource.path), await siblingNames(folder));
			if (!family.files.length) {
				throw new Error('No matching resource files found.');
			}
			const key = vscode.Uri.joinPath(folder, family.name + '.resx').toString();
			const existing = panels.get(key);
			if (existing) {
				existing.panel.reveal();
				existing.refresh();
			} else {
				const panel = vscode.window.createWebviewPanel('netresx.translationGrid', family.name,
					vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [media] });
				panels.set(key, attachGrid(panel, folder, family.name, media));
				panel.onDidDispose(() => panels.delete(key));
			}
		} catch (error) {
			void vscode.window.showErrorMessage(`Could not open the RESX resource grid: ${errorText(error)}`);
		}
	}));
	context.subscriptions.push({ dispose: () => {
		for (const { panel } of panels.values()) {
			panel.dispose();
		}
	} });
}
