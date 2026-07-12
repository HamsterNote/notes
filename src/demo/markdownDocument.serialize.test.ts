import { describe, expect, it } from "vitest";
import type { NoteBlock } from "../lib/types";
import type { DemoMarkdownDocument } from "./markdownDocument";
import {
	parseMarkdownDocument,
	serializeMarkdownDocument,
} from "./markdownDocument";
import { demoMarkdownDocument } from "./noteData";
import {
	documentParts,
	expectBlockAtIndex,
	expectChecklistBlock,
	expectChecklistItem,
	expectFirstChecklistItem,
} from "./markdownDocument.test.helpers";

describe("markdown document serialization", () => {
	it("round-trips parsed documents through serialization", () => {
		const document = parseMarkdownDocument(demoMarkdownDocument);
		const reparsed = parseMarkdownDocument(serializeMarkdownDocument(document));

		expect(reparsed.title).toBe(document.title);
		expect(reparsed.summary).toBe(document.summary);
		expect(reparsed.tagLabel).toBe(document.tagLabel);
		expect(reparsed.updatedAt).toBe(document.updatedAt);
		expect(reparsed.blocks).toHaveLength(document.blocks.length);

		for (let index = 0; index < document.blocks.length; index += 1) {
			const originalBlock = expectBlockAtIndex(document, index);
			const reparsedBlock = expectBlockAtIndex(reparsed, index);
			expect(reparsedBlock.id).toBe(originalBlock.id);
			expect(reparsedBlock.kind).toBe(originalBlock.kind);
			expect(reparsedBlock).toEqual(originalBlock);
		}
	});

	it("reflects metadata edits only in the JSON fence while preserving updatedAt", () => {
		const document = parseMarkdownDocument(demoMarkdownDocument);
		const editedDocument: DemoMarkdownDocument = {
			...document,
			summary: "Edited summary",
			tagLabel: "Edited tag",
			title: "Edited title",
		};
		const serialized = serializeMarkdownDocument(editedDocument);
		const { body, metadata } = documentParts(serialized);
		const reparsed = parseMarkdownDocument(serialized);

		expect(metadata).toContain('"title": "Edited title"');
		expect(metadata).toContain('"summary": "Edited summary"');
		expect(metadata).toContain('"tagLabel": "Edited tag"');
		expect(metadata).toContain('"updatedAt": "2026-07-11"');
		expect(body).not.toContain("Edited title");
		expect(body).not.toContain("Edited summary");
		expect(body).not.toContain("Edited tag");
		expect(reparsed.updatedAt).toBe(document.updatedAt);
	});

	it("persists checklist block edits through serialization without changing updatedAt", () => {
		const document = parseMarkdownDocument(demoMarkdownDocument);
		const checklist = expectChecklistBlock(document, "checklist");
		const firstItem = expectFirstChecklistItem(checklist);
		const editedItemText = "Confirm edited checklist persistence.";
		const editedBlocks: readonly NoteBlock[] = document.blocks.map((block) => {
			if (block.kind !== "checklist" || block.id !== checklist.id) return block;
			return {
				...block,
				items: block.items.map((item) =>
					item.id === firstItem.id
						? { ...item, checked: !item.checked, text: editedItemText }
						: item,
				),
			};
		});
		const editedDocument: DemoMarkdownDocument = {
			...document,
			blocks: editedBlocks,
		};
		const reparsed = parseMarkdownDocument(
			serializeMarkdownDocument(editedDocument),
		);
		const reparsedChecklist = expectChecklistBlock(reparsed, checklist.id);
		const reparsedItem = expectChecklistItem(reparsedChecklist, firstItem.id);

		expect(reparsedItem.checked).toBe(!firstItem.checked);
		expect(reparsedItem.text).toBe(editedItemText);
		expect(reparsed.updatedAt).toBe(document.updatedAt);
	});
});
