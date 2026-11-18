import * as path from 'node:path';
import * as vscode from 'vscode';
import { cultureSuffix, findResourceFamily, readResx, resourceMarkup, type ResourceDocument } from './resx';

const header = `<?xml version="1.0" encoding="utf-8"?>
<root>
  <xsd:schema id="root" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata">
    <xsd:import namespace="http://www.w3.org/XML/1998/namespace" />
    <xsd:element name="root" msdata:IsDataSet="true">
      <xsd:complexType>
        <xsd:choice minOccurs="0" maxOccurs="unbounded">
          <xsd:element name="resheader" type="headerEntry" />
          <xsd:element name="metadata" type="resourceEntry" />
          <xsd:element name="data" type="resourceEntry" />
          <xsd:element name="assembly">
            <xsd:complexType>
              <xsd:attribute name="alias" type="xsd:string" />
              <xsd:attribute name="name" type="xsd:string" />
            </xsd:complexType>
          </xsd:element>
        </xsd:choice>
      </xsd:complexType>
    </xsd:element>
    <xsd:complexType name="headerEntry">
      <xsd:sequence>
        <xsd:element name="value" type="xsd:string" minOccurs="0" />
      </xsd:sequence>
      <xsd:attribute name="name" type="xsd:string" use="required" />
    </xsd:complexType>
    <xsd:complexType name="resourceEntry">
      <xsd:sequence>
        <xsd:element name="value" type="xsd:string" minOccurs="0" />
        <xsd:element name="comment" type="xsd:string" minOccurs="0" />
      </xsd:sequence>
      <xsd:attribute name="name" type="xsd:string" use="required" />
      <xsd:attribute name="type" type="xsd:string" />
      <xsd:attribute name="mimetype" type="xsd:string" />
      <xsd:attribute ref="xml:space" />
    </xsd:complexType>
  </xsd:schema>
  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>
  <resheader name="version"><value>2.0</value></resheader>
  <resheader name="reader"><value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>
  <resheader name="writer"><value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>
`;

export function scaffoldResx(source?: ResourceDocument): string {
	const lines: string[] = [];
	for (const [key, { value }] of source?.entries ?? []) {
		if (value.kind === 'text') {
			lines.push(...resourceMarkup(key, value.text).map(line => '  ' + line));
		}
	}
	return header + (lines.length ? lines.join('\n') + '\n' : '') + '</root>\n';
}

function requestedCultures(value: string): Set<string> {
	const cultures = new Set<string>();
	for (const part of value.split(',').map(part => part.trim()).filter(Boolean)) {
		const culture = part.toLowerCase() === 'default' ? '' : cultureSuffix(part);
		if (culture === undefined) {
			throw new Error(`"${part}" is not a recognized culture. Use a tag like hu or en-US.`);
		}
		cultures.add(culture);
	}
	return cultures;
}

export async function createResourceFiles(uri?: vscode.Uri) {
	const selected = uri ?? vscode.window.activeTextEditor?.document.uri;
	if (!selected || !vscode.workspace.fs.isWritableFileSystem(selected.scheme)) {
		void vscode.window.showErrorMessage('Select a writable folder or a RESX file in Explorer.');
		return;
	}
	try {
		const item = await vscode.workspace.fs.stat(selected);
		const fromFolder = (item.type & vscode.FileType.Directory) !== 0;
		if (!fromFolder && !selected.path.endsWith('.resx')) {
			throw new Error('Select a folder or a RESX file.');
		}
		const folder = fromFolder ? selected : vscode.Uri.joinPath(selected, '..');
		const siblings = await vscode.workspace.fs.readDirectory(folder);
		const existing = new Set(siblings.map(([name]) => name.toLowerCase()));
		let name;
		if (fromFolder) {
			const input = await vscode.window.showInputBox({
				title: 'Create RESX Files',
				prompt: 'Enter the base resource name',
				placeHolder: 'Labels',
				validateInput(value) {
					const base = value.trim().replace(/\.resx$/i, '');
					if (!base || /[<>:"/\\|?*\u0000-\u001f]/u.test(base) || /^[.]|[.]$/.test(base)) {
						return 'Enter a valid file name, such as Labels.';
					}
					const lastDot = base.lastIndexOf('.');
					return lastDot > 0 && cultureSuffix(base.slice(lastDot + 1))
						? 'Enter the base name here and choose the culture in the next step.'
						: undefined;
				},
			});
			if (input === undefined) {
				return;
			}
			name = input.trim().replace(/\.resx$/i, '');
		} else {
			const files = siblings.filter(([, type]) => type & vscode.FileType.File).map(([name]) => name);
			name = findResourceFamily(path.posix.basename(selected.path), files).name;
		}
		const input = await vscode.window.showInputBox({
			title: `Create RESX Files for ${name}`,
			prompt: fromFolder
				? 'Enter comma-separated cultures, or leave blank to create only the default file'
				: 'Enter comma-separated cultures. Use "default" to create the neutral file',
			placeHolder: 'en, hu, pt-BR',
			validateInput(value) {
				try {
					return requestedCultures(value).size || fromFolder ? undefined : 'Enter at least one culture.';
				} catch (error) {
					return String((error as Error).message);
				}
			},
		});
		if (input === undefined) {
			return;
		}
		const cultures = requestedCultures(input);
		if (fromFolder) {
			cultures.add('');
		}
		const neutralFile = name + '.resx';
		const requested = [...cultures].map(culture => culture ? `${name}.${culture}.resx` : neutralFile);
		const newFiles = requested.filter(file => !existing.has(file.toLowerCase()));
		if (!newFiles.length) {
			void vscode.window.showInformationMessage('The requested RESX files already exist.');
			return;
		}
		const neutral = siblings.find(([file, type]) => file === neutralFile && (type & vscode.FileType.File));
		let seed: ResourceDocument | undefined;
		if (neutral) {
			const blank = 'Leave values missing';
			const copy = 'Copy neutral string values';
			const choice = await vscode.window.showQuickPick([blank, copy], {
				title: 'Choose Initial Values',
				placeHolder: 'Missing values use .NET culture fallback',
			});
			if (!choice) {
				return;
			}
			if (choice === copy) {
				const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, neutral[0]));
				seed = readResx(document.getText());
			}
		}
		const bytes = Buffer.from(scaffoldResx(seed), 'utf8');
		const edit = new vscode.WorkspaceEdit();
		for (const file of newFiles) {
			edit.createFile(vscode.Uri.joinPath(folder, file), { contents: bytes, overwrite: false });
		}
		if (!await vscode.workspace.applyEdit(edit)) {
			throw new Error('VS Code could not create all requested files. Existing files were kept.');
		}
		const skipped = requested.length - newFiles.length;
		const count = newFiles.length === 1 ? newFiles[0] : `${newFiles.length} RESX files`;
		void vscode.window.showInformationMessage(`Created ${count}.${skipped ? ` Skipped ${skipped} existing.` : ''}`);
	} catch (error) {
		void vscode.window.showErrorMessage('Could not create RESX files. ' + (error instanceof Error ? error.message : String(error)));
	}
}
