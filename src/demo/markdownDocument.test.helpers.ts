import { expect } from "vitest";
import type {
	NoteBlock,
	NoteChecklistBlock,
	NoteChecklistItem,
} from "../lib/types";
import type { DemoMarkdownDocument } from "./markdownDocument";
import { DemoMarkdownParseError, parseMarkdownDocument } from "./markdownDocument";

export const expectBlock = (
	document: DemoMarkdownDocument,
	id: string,
): NoteBlock => {
	const block = document.blocks.find((candidate) => candidate.id === id);
	if (block === undefined) throw new Error(`Expected block ${id} to exist.`);
	return block;
};

export const expectChecklistBlock = (
	document: DemoMarkdownDocument,
	id: string,
): NoteChecklistBlock => {
	const block = expectBlock(document, id);
	if (block.kind !== "checklist") {
		throw new Error(`Expected block ${id} to be a checklist.`);
	}
	return block;
};

export const expectChecklistItem = (
	block: NoteChecklistBlock,
	id: string,
): NoteChecklistItem => {
	const item = block.items.find((candidate) => candidate.id === id);
	if (item === undefined) {
		throw new Error(`Expected checklist item ${id} to exist.`);
	}
	return item;
};

export const expectFirstChecklistItem = (
	block: NoteChecklistBlock,
): NoteChecklistItem => {
	const item = block.items[0];
	if (item === undefined) {
		throw new Error("Expected checklist to contain at least one item.");
	}
	return item;
};

export const expectBlockAtIndex = (
	document: DemoMarkdownDocument,
	index: number,
): NoteBlock => {
	const block = document.blocks[index];
	if (block === undefined) {
		throw new Error(`Expected block at index ${index} to exist.`);
	}
	return block;
};

export const stringContaining = (
	s: string,
): { asymmetricMatch: (other: string) => boolean } => ({
	asymmetricMatch: (other: string) => other.includes(s),
});

export const documentParts = (
	markdown: string,
): { readonly metadata: string; readonly body: string } => {
	const splitToken = "\n```\n\n";
	const bodyStart = markdown.indexOf(splitToken);
	if (bodyStart === -1) {
		throw new Error("Expected serialized markdown to contain metadata and body.");
	}
	return {
		metadata: markdown.slice(0, bodyStart + "\n```".length),
		body: markdown.slice(bodyStart + splitToken.length),
	};
};

export const expectParseErrorCode = (markdown: string, code: string): void => {
	try {
		parseMarkdownDocument(markdown);
	} catch (error) {
		if (error instanceof DemoMarkdownParseError) {
			expect(error.code).toBe(code);
			return;
		}
		throw error;
	}
	throw new Error(`Expected DemoMarkdownParseError with code ${code}.`);
};
