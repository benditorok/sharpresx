'use strict';

const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const search = byId('grid-search');
const headers = byId('grid-headers');
const rows = byId('grid-rows');
const message = byId('grid-message');
const errors = byId('errors');
const table = document.querySelector('.table-wrapper');
const add = byId('add-key');
const sort = byId('sort-keys');
const save = byId('save-files');
const dialog = byId('edit-dialog');
const form = byId('edit-form');
const fields = byId('dialog-fields');
const hint = byId('dialog-hint');
const dialogError = byId('dialog-error');
const cancel = byId('cancel-edit');
const submit = byId('submit-edit');

let state;
let pending = false;
let activeDialog;
let feedback = '';

function node(tag, text = '', className) {
	const element = document.createElement(tag);
	element.textContent = text;
	if (className) {
		element.className = className;
	}
	return element;
}

function button(text, action) {
	const element = node('button', text);
	element.type = 'button';
	element.addEventListener('click', action);
	return element;
}

function renderRows() {
	const query = search.value.toLowerCase().trim();
	const matching = state?.rows.filter(row => !query || row.key.toLowerCase().includes(query) ||
		row.cells.some(cell => (cell.text ?? cell.searchValue)?.toLowerCase().includes(query))) ?? [];
	const fragment = document.createDocumentFragment();
	for (const { key, cells } of matching) {
		const row = node('tr');
		const header = node('th', key);
		header.scope = 'row';
		row.append(header);
		cells.forEach((cell, index) => {
			const file = state.files[index];
			const col = node('td');
			const editable = state.editable && !['Non-string', 'Unavailable'].includes(cell.status);
			const value = cell.status ?? cell.text ?? '';
			const content = cell.status ? node('span', value, 'cell-status') : node('span', value, 'translation');
			if (cell.text !== undefined && !cell.status) {
				content.dir = 'auto';
				if (file.culture) {
					content.lang = file.culture;
				}
			}
			if (editable) {
				const edit = button('', () => openEdit(key, file, cell.text ?? ''));
				edit.className = 'cell-edit';
				edit.setAttribute('aria-label', 'Edit ' + key + ' in ' + file.fileName + ': ' + value);
				edit.append(content);
				col.append(edit);
			} else {
				col.append(content);
			}
			if (cell.warning || ['Missing', 'Empty', 'Whitespace only'].includes(cell.status)) {
				col.classList.add('warning-cell');
			}
			if (cell.warning) {
				col.append(node('span', cell.warning, 'cell-warning'));
			}
			row.append(col);
		});
		const actions = node('td');
		if (state.editable) {
			const remove = button('Delete', () => openDelete(key));
			remove.setAttribute('aria-label', 'Delete ' + key);
			actions.append(remove);
		}
		row.append(actions);
		fragment.append(row);
	}
	rows.replaceChildren(fragment);
	table.hidden = !matching.length;
	const summary = matching.length ? matching.length + ' of ' + state.rows.length + ' keys'
		: query ? 'No matching keys or values.' : 'No resource entries found.';
	message.textContent = feedback || (state ? summary : 'Loading resources…');
}

function renderState() {
	const key = node('th', 'Key');
	key.scope = 'col';
	const actions = node('th', 'Actions');
	actions.scope = 'col';
	headers.replaceChildren(key, ...state.files.map(file => {
		const column = node('th', file.culture ?? 'Default');
		column.scope = 'col';
		column.title = file.fileName;
		return column;
	}), actions);
	const issues = state.files.filter(file => file.error).map(file => node('li', file.fileName + ': ' + file.error));
	errors.replaceChildren(...issues);
	errors.hidden = !issues.length;
	add.disabled = !state.editable;
	sort.disabled = !state.editable || !state.rows.length;
	save.disabled = !state.canSave;
	renderRows();
}

function field(labelText, id, multiline, value = '') {
	const group = node('div', '', 'field');
	const label = node('label', labelText);
	label.htmlFor = id;
	const input = node(multiline ? 'textarea' : 'input');
	input.id = id;
	input.name = id;
	input.value = value;
	input.autocomplete = 'off';
	if (multiline) {
		input.rows = 2;
	} else {
		input.spellcheck = false;
	}
	group.append(label, input);
	fields.append(group);
	return input;
}

function showDialog(title, action, hintText, setup) {
	if (pending) {
		return;
	}
	byId('dialog-title').textContent = title;
	submit.textContent = action;
	hint.textContent = hintText;
	hint.hidden = !hintText;
	dialogError.hidden = true;
	fields.replaceChildren();
	activeDialog = { revision: state.revision, buildAction: setup() };
	dialog.showModal();
}

function openAdd() {
	showDialog('Add key', 'Add key', 'Enter a value for each file you want to update.', () => {
		const key = field('Key (required)', 'new-key', false);
		key.required = true;
		key.autofocus = true;
		const inputs = state.files.map((file, index) => ({
			file: file.fileName, input: field(file.fileName, 'file-' + index, true),
		}));
		return () => ({
			type: 'add', key: key.value.trim(),
			values: inputs.filter(({ input }) => input.value !== '')
				.map(({ file, input }) => ({ file, value: input.value })),
		});
	});
}

function openEdit(key, file, value) {
	showDialog('Edit ' + key, 'Apply change', file.fileName, () => {
		const input = field('Value', 'cell-value', true, value);
		input.autofocus = true;
		return () => ({ type: 'set', key, file: file.fileName, value: input.value });
	});
}

function openDelete(key) {
	showDialog('Delete ' + key + '?', 'Delete key', 'This removes the key from every file in this resource family.', () => {
		cancel.autofocus = true;
		return () => ({ type: 'delete', key });
	});
	cancel.autofocus = false;
}

function send(action, revision = state.revision) {
	if (pending) {
		return;
	}
	pending = true;
	submit.disabled = true;
	vscode.postMessage({ ...action, revision });
}

add.addEventListener('click', openAdd);
sort.addEventListener('click', () => send({ type: 'sort' }));
save.addEventListener('click', () => send({ type: 'save' }));
cancel.addEventListener('click', () => dialog.close());
form.addEventListener('submit', event => {
	event.preventDefault();
	const action = activeDialog.buildAction();
	if (action.type === 'add' && (!action.key || !action.values.length)) {
		dialogError.textContent = 'Enter a key and at least one value.';
		dialogError.hidden = false;
		return;
	}
	send(action, activeDialog.revision);
});
search.value = vscode.getState()?.query ?? '';
search.addEventListener('input', () => {
	feedback = '';
	vscode.setState({ query: search.value });
	renderRows();
});

window.addEventListener('message', ({ data }) => {
	if (data.type === 'state') {
		state = data;
		renderState();
	} else if (data.type === 'result') {
		pending = false;
		submit.disabled = false;
		if (data.error && dialog.open) {
			dialogError.textContent = data.error;
			dialogError.hidden = false;
		} else {
			if (dialog.open) {
				dialog.close();
			}
			feedback = data.error || data.message || '';
			renderRows();
		}
	}
});
vscode.postMessage({ type: 'ready' });
