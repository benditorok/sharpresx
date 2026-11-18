import * as path from 'node:path';
import * as vscode from 'vscode';
import { findResourceFamily } from './resx';
import { appendXmlChild, escapeXml, readXml, type XmlEdit, type XmlElement } from './xml';

function isNamed(element: XmlElement, name: string): boolean {
	return element.name.toLowerCase() === name.toLowerCase();
}

function itemPath(value: string | undefined): string | undefined {
	return value?.replaceAll('\\', '/').replace(/^\.\//, '');
}

function property(element: XmlElement, name: string): string | undefined {
	return Object.entries(element.attributes).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ??
		element.children.find(child => isNamed(child, name))?.text.trim();
}

export function designerProjectEdit(xml: string, relativePath: string) {
	const root = readXml(xml);
	if (!isNamed(root, 'Project') || !(root.attributes.Sdk || root.children.some(child =>
		isNamed(child, 'Sdk') || (isNamed(child, 'Import') && child.attributes.Sdk)))) {
		throw new Error('Designer generation requires an SDK-style C# project.');
	}

	if (!relativePath.endsWith('.resx')) {
		throw new Error('Select a neutral RESX file.');
	}
	const stem = path.posix.basename(relativePath, '.resx');
	const segments = relativePath.slice(0, -'.resx'.length).split(/[/.]/);
	if (!segments.every(segment => /^[_\p{L}][_\p{L}\p{N}]*$/u.test(segment))) {
		throw new Error('Use a resource path with valid C# identifier segments before configuring generation.');
	}
	const className = segments.pop()!;
	const namespace = '$(RootNamespace)' + (segments.length ? '.' + segments.join('.') : '');
	const output = relativePath.slice(0, -'.resx'.length) + '.Designer.cs';
	const previousOutput = '$(IntermediateOutputPath)' + stem + '.Designer.cs';
	const metadata = {
		Generator: 'MSBuild:Compile',
		StronglyTypedLanguage: 'CSharp',
		StronglyTypedFileName: output,
		StronglyTypedClassName: className,
		StronglyTypedNamespace: namespace,
	};
	const items = root.children.filter(group => isNamed(group, 'ItemGroup')).flatMap(group =>
		group.children.map(item => ({ item, group })));
	const entries = items.filter(({ item }) => isNamed(item, 'EmbeddedResource'));
	const matches = entries.filter(({ item }) =>
		itemPath(item.attributes.Include) === relativePath || itemPath(item.attributes.Update) === relativePath);
	const properties = root.children.filter(group => isNamed(group, 'PropertyGroup')).flatMap(group => group.children);
	const defaultsDisabled = properties.some(element => ['EnableDefaultItems', 'EnableDefaultEmbeddedResourceItems']
		.some(name => isNamed(element, name)) && element.text.trim().toLowerCase() === 'false');

	if (entries.some(({ item }) => itemPath(item.attributes.Remove) === relativePath) ||
		(defaultsDisabled && !matches.some(({ item }) => itemPath(item.attributes.Include) === relativePath))) {
		throw new Error('The neutral RESX must already be included as an EmbeddedResource.');
	}
	if (matches.length > 1 || matches.some(({ item, group }) => item.attributes.Condition || group.attributes.Condition)) {
		throw new Error('The resource has multiple or conditional project entries. Review its MSBuild metadata first.');
	}

	const existing = matches[0]?.item;
	const dependentConvention = !properties.some(element => isNamed(element, 'EmbeddedResourceUseDependentUponConvention') &&
		element.text.trim().toLowerCase() === 'false');
	if (existing && ['LogicalName', 'ManifestResourceName', 'DependentUpon', 'Link', 'StronglyTypedManifestPrefix']
		.some(name => property(existing, name) !== undefined)) {
		throw new Error('The resource has custom manifest naming. Review its MSBuild metadata before configuring generation.');
	}
	if (entries.some(({ item }) => item !== existing && itemPath(property(item, 'StronglyTypedFileName')) === output)) {
		throw new Error(`Another resource uses the generated file ${stem}.Designer.cs.`);
	}

	// GenerateResource adds its output to Compile during normal builds. Keep the file
	// available to IDE analysis when design-time builds skip resource generation.
	const buildCondition = "'$(DesignTimeBuild)' != 'true'";
	const compileItems = items.filter(({ item }) => isNamed(item, 'Compile'));
	// A later explicit Include can re-add the file after an earlier Remove.
	const lastCompileItem = compileItems.reverse().find(({ item }) =>
		itemPath(item.attributes.Remove) === output || itemPath(item.attributes.Include) === output);
	const needsExclusion = !lastCompileItem || itemPath(lastCompileItem.item.attributes.Remove) !== output ||
		Boolean(lastCompileItem.group.attributes.Condition) ||
		(Boolean(lastCompileItem.item.attributes.Condition) && lastCompileItem.item.attributes.Condition !== buildCondition);
	const compileLine = `<Compile Remove="${escapeXml(output, true)}" Condition="${buildCondition}" />`;

	const edits: XmlEdit[] = [];
	const lines: string[] = [];
	let migratedLine: string | undefined;
	for (const [name, value] of Object.entries(metadata)) {
		const present = existing && property(existing, name);
		const normalized = name === 'StronglyTypedFileName' ? itemPath(present) : present;
		const line = `<${name}>${escapeXml(value)}</${name}>`;
		if (present === undefined) {
			lines.push(line);
		} else if (normalized !== value) {
			const previous = name === 'StronglyTypedFileName' && normalized === previousOutput
				? existing?.children.find(child => isNamed(child, name) && !child.attributes.Condition)
				: undefined;
			if (!previous || previous.selfClosing || previous.children.length ||
				Object.keys(existing!.attributes).some(attribute => attribute.toLowerCase() === name.toLowerCase())) {
				throw new Error(`The resource already specifies different ${name} metadata.`);
			}
			edits.push({ start: previous.openEnd, end: previous.closeStart, text: escapeXml(value) });
			migratedLine = line;
		}
	}

	const itemLine = `<EmbeddedResource ${existing?.attributes.Include ? 'Include' : 'Update'}="${escapeXml(relativePath, true)}">`;
	const previewLines = lines.concat(migratedLine ?? []);
	const resourcePreview = previewLines.length ? [itemLine, ...previewLines.map(line => '  ' + line), '</EmbeddedResource>'] : [];
	const preview = [...(needsExclusion ? [compileLine] : []), ...resourcePreview].join('\n');
	if (existing && lines.length) {
		edits.push(appendXmlChild(xml, existing, lines));
	}
	const groupLines = [...(needsExclusion ? [compileLine] : []), ...(existing ? [] : resourcePreview)];
	if (groupLines.length) {
		edits.push(appendXmlChild(xml, root, ['<ItemGroup>', ...groupLines.map(line => '  ' + line), '</ItemGroup>']));
	}
	const outputAlreadyConfigured = itemPath(existing && property(existing, 'StronglyTypedFileName')) === output;
	return { edits, preview, dependentConvention, outputAlreadyConfigured };
}

async function findProject(folder: vscode.Uri, boundary?: vscode.Uri): Promise<vscode.Uri | undefined> {
	while (true) {
		const projects = (await vscode.workspace.fs.readDirectory(folder))
			.filter(([name, type]) => (type & vscode.FileType.File) && name.toLowerCase().endsWith('.csproj'))
			.map(([label]) => ({ label, uri: vscode.Uri.joinPath(folder, label) }));
		if (projects.length > 1) {
			return (await vscode.window.showQuickPick(projects, { title: 'Choose the C# project that owns this resource' }))?.uri;
		}
		if (projects.length === 1) {
			return projects[0].uri;
		}
		const parent = vscode.Uri.joinPath(folder, '..');
		if (folder.toString() === boundary?.toString() || parent.path === folder.path) {
			break;
		}
		folder = parent;
	}
	throw new Error('No enclosing .csproj was found.');
}

async function hasFile(uri: vscode.Uri): Promise<boolean> {
	try {
		return Boolean((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File);
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return false;
		}
		throw error;
	}
}

export async function configureDesigner(uri?: vscode.Uri) {
	const selected = uri ?? vscode.window.activeTextEditor?.document.uri;
	if (!selected?.path.endsWith('.resx') || !vscode.workspace.fs.isWritableFileSystem(selected.scheme)) {
		void vscode.window.showErrorMessage('Select a writable RESX file.');
		return;
	}
	try {
		const folder = vscode.Uri.joinPath(selected, '..');
		const names = (await vscode.workspace.fs.readDirectory(folder))
			.filter(([, type]) => type & vscode.FileType.File).map(([name]) => name);
		const family = findResourceFamily(path.posix.basename(selected.path), names);
		const neutral = family.files.find(file => !file.culture);
		if (!neutral) {
			throw new Error('Create the neutral RESX file before configuring designer generation.');
		}
		const project = await findProject(folder, vscode.workspace.getWorkspaceFolder(selected)?.uri);
		if (!project) {
			return;
		}
		const relative = path.posix.relative(path.posix.dirname(project.path), vscode.Uri.joinPath(folder, neutral.fileName).path);
		const document = await vscode.workspace.openTextDocument(project);
		const version = document.version;
		const wasDirty = document.isDirty;
		const plan = designerProjectEdit(document.getText(), relative);
		if (!plan.edits.length) {
			void vscode.window.showInformationMessage(`Designer generation is already configured for ${neutral.fileName}.`);
			return;
		}
		if (!plan.outputAlreadyConfigured && await hasFile(vscode.Uri.joinPath(folder, family.name + '.Designer.cs'))) {
			throw new Error('A Designer.cs already exists beside this resource. Review it before configuring MSBuild to generate that file.');
		}
		if (plan.dependentConvention && await hasFile(vscode.Uri.joinPath(folder, family.name + '.cs'))) {
			throw new Error('A matching C# source file may change the resource manifest name. Review the project metadata first.');
		}
		const action = 'Update Project';
		const accepted = await vscode.window.showInformationMessage(`Configure ${family.name}.Designer.cs in ${path.posix.basename(project.path)}?`, {
			modal: true, detail: plan.preview,
		}, action);
		if (accepted !== action) {
			return;
		}
		if (document.isClosed || document.version !== version) {
			throw new Error('The project changed during the preview. Run the command again.');
		}
		const edit = new vscode.WorkspaceEdit();
		for (const { start, end, text } of plan.edits) {
			edit.replace(project, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
		}
		if (!await vscode.workspace.applyEdit(edit)) {
			throw new Error('VS Code could not update the project.');
		}
		if (wasDirty || !await document.save()) {
			void vscode.window.showInformationMessage('Designer metadata added. Save the project, then run dotnet build.');
		} else {
			void vscode.window.showInformationMessage('Designer metadata saved. Run dotnet build to generate the class.');
		}
	} catch (error) {
		void vscode.window.showErrorMessage('Could not configure the resource designer. ' +
			(error instanceof Error ? error.message : String(error)));
	}
}
