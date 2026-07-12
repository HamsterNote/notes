import { describe, expect, it } from "vitest";
import { parseMarkdownDocument } from "./markdownDocument";
import { demoMarkdownDocument } from "./noteData";
import {
	expectBlock,
	expectChecklistBlock,
	expectParseErrorCode,
	stringContaining,
} from "./markdownDocument.test.helpers";

describe("markdown document parsing", () => {
	it("parses default document metadata correctly", () => {
		const document = parseMarkdownDocument(demoMarkdownDocument);

		expect(document.title).toBe("Launch Notes for the first public package");
		expect(document.summary).toContain("editorial note surface");
		expect(document.tagLabel).toBe("Release candidate");
		expect(document.updatedAt).toBe("2026-07-11");
	});

	it("preserves representative fields from the default document blocks", () => {
		const document = parseMarkdownDocument(demoMarkdownDocument);

		expect(document.blocks).toHaveLength(10);
		expect(expectBlock(document, "hero")).toMatchObject({
			eyebrow: "Hamster Note",
			kind: "heading",
			level: 1,
			text: stringContaining("Ship a note component"),
		});
		expect(expectBlock(document, "intro")).toMatchObject({
			kind: "paragraph",
			tone: "accent",
		});
		expect(expectBlock(document, "principle")).toMatchObject({
			kind: "quote",
			text: stringContaining("Readable note surfaces"),
		});
		expect(expectBlock(document, "subheading")).toMatchObject({
			eyebrow: "Launch checklist",
			kind: "heading",
			level: 2,
		});

		const checklist = expectChecklistBlock(document, "checklist");
		expect(checklist.title).toBe("Release readiness");
		expect(checklist.items).toHaveLength(3);
		expect(checklist.items.some((item) => item.checked)).toBe(true);
		expect(checklist.items.every((item) => item.checked)).toBe(true);
		for (const item of checklist.items) {
			expect(item.id).not.toBe("");
			expect(item.text).not.toBe("");
			expect(typeof item.checked).toBe("boolean");
		}

		expect(expectBlock(document, "callout")).toMatchObject({
			kind: "callout",
			text: stringContaining("typed block array"),
			title: "Structured input, flexible visuals",
			tone: "info",
		});
		expect(expectBlock(document, "code-heading")).toMatchObject({
			kind: "heading",
			level: 3,
		});

		const code = expectBlock(document, "code");
		expect(code).toMatchObject({
			filename: "App.tsx",
			kind: "code",
			language: "tsx",
		});
		if (code.kind !== "code") throw new Error("Expected code block.");
		expect(code.code.trim()).not.toBe("");

		expect(expectBlock(document, "ending")).toMatchObject({
			kind: "paragraph",
			tone: "muted",
		});
		expect(expectBlock(document, "warning")).toMatchObject({
			kind: "callout",
			title: "Versioning rule",
			tone: "warning",
		});
	});

	it("parses quote author from the author line", () => {
		const document = parseMarkdownDocument(demoMarkdownDocument);

		expect(expectBlock(document, "principle")).toMatchObject({
			author: "Design note",
			kind: "quote",
		});
	});

	it("throws stable parser errors for invalid metadata documents", () => {
		expectParseErrorCode("# Hello", "MISSING_METADATA_BLOCK");
		expectParseErrorCode(
			"```json\nnot json\n```\n\n# Hello",
			"INVALID_METADATA_JSON",
		);
		expectParseErrorCode("```json\n{}\n```\n\n# Hello", "MISSING_TITLE");
		expectParseErrorCode(
			'```json\n{"title":"T","summary":"S","tagLabel":"L","updatedAt":123}\n```\n\n# Hello',
			"INVALID_UPDATED_AT",
		);
	});
});
