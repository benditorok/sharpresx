'use strict';

const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const search = byId('grid-search');
const headers = byId('grid-headers');
const rows = byId('grid-rows');
const message = byId('grid-message');
const empty = byId('grid-empty');
const errors = byId('errors');
const table = document.querySelector('.table-wrapper');
const add = byId('add-key');
const remove = byId('delete-keys');
const duplicate = byId('duplicate-key');
const sort = byId('sort-keys');
const save = byId('save-files');
const saved = vscode.getState();
const selected = new Set(saved?.selected ?? []);
const visibleRows = new Map();

let state;
let anchor;
let editor;
let refreshAfterEdit = false;
let pending;
let saveAfterEdit = false;

function node(tag, text = '', className = '') {
	const element = document.createElement(tag);
	element.textContent = text;
	element.className = className;
	return element;
}

function button(text, className, action) {
	const element = node('button', text, className);
	element.type = 'button';
	element.addEventListener('click', action);
	return element;
}

function setError(text) {
	message.textContent = text;
}

function updateMessage() {
	empty.textContent = state && !visibleRows.size && !editor
		? (search.value.trim() ? 'No matches.' : 'No resource entries.') : '';
}

function persistState() {
	vscode.setState({ query: search.value, selected: [...selected] });
}

function updateToolbar() {
	const blocked = !state?.editable || Boolean(pending);
	add.disabled = blocked;
	remove.disabled = blocked || !selected.size;
	duplicate.disabled = blocked || !selected.size;
	sort.disabled = blocked || !state.rows.length;
	save.disabled = Boolean(pending) || (!editor && !state?.canSave);
}

function updateSelection() {
	for (const [key, row] of visibleRows) {
		const pressed = selected.has(key);
		row.classList.toggle('selected', pressed);
		row.querySelector('.key-select').setAttribute('aria-pressed', String(pressed));
	}
	updateToolbar();
	persistState();
}

function select(key, event) {
	const toggle = event.ctrlKey || event.metaKey;
	if (event.shiftKey && visibleRows.has(anchor)) {
		const keys = [...visibleRows.keys()];
		const start = keys.indexOf(anchor);
		const end = keys.indexOf(key);
		if (!toggle) {
			selected.clear();
		}
		for (const key of keys.slice(Math.min(start, end), Math.max(start, end) + 1)) {
			selected.add(key);
		}
	} else if (toggle) {
		if (!selected.delete(key)) {
			selected.add(key);
		}
		anchor = key;
	} else {
		const deselect = selected.size === 1 && selected.has(key);
		selected.clear();
		if (!deselect) {
			selected.add(key);
		}
		anchor = key;
	}
	updateSelection();
}

function renderCell(key, cell, file) {
	const column = node('td');
	const value = cell.status ?? cell.text ?? '';
	const content = node('span', value, cell.status ? 'cell-status' : 'translation');
	const locale = file.culture ?? 'Default';
	if (!cell.status) {
		content.dir = 'auto';
		if (file.culture) {
			content.lang = file.culture;
		}
	}
	if (state.editable && !['Non-string', 'Unavailable'].includes(cell.status)) {
		const edit = button('', 'cell-edit', event => {
			if (event.ctrlKey || event.metaKey || event.shiftKey) {
				select(key, event);
			} else if (!pending && !editor) {
				if (!selected.has(key)) {
					select(key, event);
				}
				openCellEditor(edit, key, cell, file);
			}
		});
		edit.setAttribute('aria-label', 'Edit ' + key + ' in ' + locale + ': ' + value);
		edit.append(content);
		column.append(edit);
	} else {
		column.append(content);
	}
	if (cell.warning || ['Missing', 'Empty', 'Whitespace only'].includes(cell.status)) {
		column.classList.add('warning-cell');
	}
	if (cell.warning) {
		column.append(node('span', cell.warning, 'cell-warning'));
	}
	return column;
}

function renderRows() {
	if (editor) {
		refreshAfterEdit = true;
		return;
	}
	const focus = document.activeElement;
	const focusKey = focus?.closest('[data-key]')?.dataset.key;
	const focusColumn = focus?.closest('th, td')?.cellIndex;
	const query = search.value.trim().toLowerCase();
	visibleRows.clear();
	const fragment = document.createDocumentFragment();
	for (const { key, cells } of state?.rows ?? []) {
		if (query && !key.toLowerCase().includes(query) &&
			!cells.some(cell => (cell.text ?? cell.searchValue)?.toLowerCase().includes(query))) {
			continue;
		}
		const row = node('tr');
		row.dataset.key = key;
		const header = node('th');
		header.scope = 'row';
		const trigger = button(key, 'key-select', event => select(key, event));
		if (state.editable) {
			trigger.title = 'Double-click or press F2 to rename';
			trigger.setAttribute('aria-keyshortcuts', 'F2');
			trigger.addEventListener('dblclick', event => {
				if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
					openKeyEditor(trigger, key);
				}
			});
			trigger.addEventListener('keydown', event => {
				if (event.key === 'F2') {
					event.preventDefault();
					openKeyEditor(trigger, key);
				}
			});
		}
		header.append(trigger);
		row.append(header, ...cells.map((cell, index) => renderCell(key, cell, state.files[index])));
		visibleRows.set(key, row);
		fragment.append(row);
	}
	rows.replaceChildren(fragment);
	for (const key of selected) {
		if (!visibleRows.has(key)) {
			selected.delete(key);
		}
	}
	table.hidden = !visibleRows.size;
	updateSelection();
	updateMessage();
	if (focusKey !== undefined && focusColumn !== undefined) {
		visibleRows.get(focusKey)?.cells[focusColumn]?.querySelector('button')?.focus({ preventScroll: true });
	}
}

function renderState() {
	const columns = ['Key', ...state.files.map(file => file.culture ?? 'Default')];
	table.style.setProperty('--grid-column-count', String(columns.length));
	headers.replaceChildren(...columns.map(label => {
		const column = node('th', label);
		column.scope = 'col';
		return column;
	}));
	const issues = state.files.filter(file => file.error)
		.map(file => node('li', (file.culture ?? 'Default') + ': ' + file.error));
	errors.replaceChildren(...issues);
	errors.hidden = !issues.length;
	renderRows();
}

function send(action, revision = state.revision) {
	if (pending) {
		return;
	}
	pending = action;
	updateToolbar();
	vscode.postMessage({ ...action, revision });
}

function startEditor(input, readAction, restore) {
	const revision = state.revision;
	const current = { finish };
	editor = current;
	updateToolbar();
	function finish(commit, keyboard) {
		if (editor !== current) {
			return true;
		}
		const action = commit ? readAction() : undefined;
		if (action === false && keyboard) {
			return false;
		}
		editor = undefined;
		restore(keyboard);
		if (action) {
			send(action, revision);
		}
		if (refreshAfterEdit) {
			refreshAfterEdit = false;
			renderState();
		}
		table.hidden = !visibleRows.size;
		updateToolbar();
		updateMessage();
		return true;
	}
	input.addEventListener('keydown', event => {
		if (event.isComposing) {
			return;
		}
		if (event.key === 'Escape' || (event.key === 'Enter' && !(input instanceof HTMLTextAreaElement && event.shiftKey))) {
			event.preventDefault();
			finish(event.key === 'Enter', true);
		}
	});
	input.addEventListener('blur', () => finish(true, false));
	input.focus();
}

function openCellEditor(trigger, key, cell, file) {
	const input = node('textarea', '', 'inline-input');
	input.value = cell.text ?? '';
	const original = input.value;
	input.rows = 1;
	input.dir = 'auto';
	input.setAttribute('aria-label', 'Value for ' + key + ' in ' + (file.culture ?? 'Default'));
	trigger.replaceWith(input);
	startEditor(input, () => input.value === original ? undefined
		: { type: 'set', key, file: file.fileName, value: input.value }, keyboard => {
		input.replaceWith(trigger);
		if (keyboard) {
			trigger.focus();
		}
	});
}

function keyInput(label) {
	const input = node('input', '', 'inline-input');
	input.type = 'text';
	input.setAttribute('aria-label', label);
	input.setAttribute('aria-describedby', 'grid-message');
	input.addEventListener('input', () => {
		input.removeAttribute('aria-invalid');
		setError('');
	});
	input.autocomplete = 'off';
	input.spellcheck = false;
	setError('');
	return input;
}

function validKey(input, key) {
	const error = !key ? 'Enter a resource key.'
		: state.rows.some(row => row.key === key) ? '"' + key + '" already exists.' : '';
	if (error) {
		input.setAttribute('aria-invalid', 'true');
		setError(error);
		return false;
	}
	return true;
}

function openKeyEditor(trigger, key) {
	if (editor || pending) {
		return;
	}
	if (!selected.has(key)) {
		selected.clear();
		selected.add(key);
		updateSelection();
	}
	const input = keyInput('Rename ' + key);
	input.value = key;
	const original = input.value;
	trigger.replaceWith(input);
	startEditor(input, () => {
		if (input.value === original) {
			return undefined;
		}
		const newKey = input.value.trim();
		if (newKey === key) {
			return undefined;
		}
		return validKey(input, newKey) && { type: 'rename', key, newKey };
	}, keyboard => {
		input.replaceWith(trigger);
		if (keyboard) {
			trigger.focus();
		}
	});
	input.select();
}

function openNewKey() {
	if (editor || pending) {
		return;
	}
	const row = node('tr');
	const cell = node('th');
	cell.scope = 'row';
	const input = keyInput('New resource key');
	input.placeholder = 'New key';
	cell.append(input);
	row.append(cell);
	const blank = node('td');
	blank.colSpan = state.files.length;
	row.append(blank);
	rows.prepend(row);
	table.hidden = false;
	startEditor(input, () => {
		const key = input.value.trim();
		return key ? validKey(input, key) && { type: 'add', key } : undefined;
	}, keyboard => {
		row.remove();
		if (keyboard) {
			add.focus();
		}
	});
}

function requestSave() {
	if (!state || pending?.type === 'save' || (editor && !editor.finish(true, true))) {
		return;
	}
	if (pending) {
		saveAfterEdit = true;
	} else if (state.canSave) {
		send({ type: 'save' });
	}
}

add.addEventListener('click', openNewKey);
remove.addEventListener('click', () => send({ type: 'delete', keys: [...selected] }));
duplicate.addEventListener('click', () => send({ type: 'duplicate', keys: [...selected] }));
sort.addEventListener('click', () => send({ type: 'sort' }));
save.addEventListener('mousedown', event => {
	if (editor) {
		event.preventDefault();
	}
});
save.addEventListener('click', requestSave);
search.value = saved?.query ?? '';
search.addEventListener('input', () => {
	setError('');
	renderRows();
});

window.addEventListener('message', ({ data }) => {
	if (data.type === 'saveRequested') {
		requestSave();
	} else if (data.type === 'state') {
		const redraw = !state || state.revision !== data.revision || state.editable !== data.editable;
		state = data;
		if (redraw && !editor) {
			renderState();
		} else {
			refreshAfterEdit ||= redraw;
			updateToolbar();
		}
	} else if (data.type === 'result') {
		const completed = pending;
		pending = undefined;
		setError(data.error ?? '');
		updateToolbar();
		if (!data.error && (completed?.type === 'add' || completed?.type === 'rename')) {
			const key = completed.type === 'rename' ? completed.newKey : completed.key;
			if (completed.type === 'add') {
				selected.clear();
			}
			selected.add(key);
			anchor = key;
			if (!visibleRows.has(key)) {
				search.value = '';
				renderRows();
			} else {
				updateSelection();
			}
			visibleRows.get(key)?.querySelector('.key-select')?.focus();
		}
		if (saveAfterEdit) {
			saveAfterEdit = false;
			if (!data.error) {
				requestSave();
			}
		}
	}
});
vscode.postMessage({ type: 'ready' });
