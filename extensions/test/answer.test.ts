import assert from "node:assert/strict";
import test from "node:test";
import { isAuthRelatedExtractionError, isRecoverableExtractionError, parseExtractionResult } from "../answer/index.ts";

test("parseExtractionResult parses JSON code blocks", () => {
	const result = parseExtractionResult(
		"```json\n{\"questions\":[{\"question\":\"What is your name?\",\"context\":\"Optional context\"}]}\n```",
	);
	assert.deepEqual(result, {
		questions: [{ question: "What is your name?", context: "Optional context" }],
	});
});

test("parseExtractionResult extracts JSON from surrounding text", () => {
	const result = parseExtractionResult(
		"Here are the questions:\n{\"questions\":[{\"question\":\"Q1\",\"context\":\"  needs context  \"},{\"question\":\"Q2\"}]}\nDone.",
	);
	assert.deepEqual(result, {
		questions: [{ question: "Q1", context: "needs context" }, { question: "Q2" }],
	});
});

test("parseExtractionResult trims and filters invalid question entries", () => {
	const result = parseExtractionResult(
		'{"questions":[{"question":"   Valid one  ","context":"  trim me  "},{"question":"   "},{"context":"missing question"},"ignore",{"question":"Another", "context":"   "}]}'
	);
	assert.deepEqual(result, {
		questions: [
			{ question: "Valid one", context: "trim me" },
			{ question: "Another" },
		],
	});
});

test("parseExtractionResult returns null for malformed JSON", () => {
	assert.equal(parseExtractionResult('{"questions":[{"question":"oops"'), null);
});

test("parseExtractionResult returns null for invalid shape", () => {
	assert.equal(parseExtractionResult('{"notQuestions":[]}'), null);
});

test("auth errors are recoverable", () => {
	assert.equal(isAuthRelatedExtractionError("No API key configured"), true);
	assert.equal(isRecoverableExtractionError("No API key configured"), true);
});

test("transient failures are recoverable", () => {
	assert.equal(isRecoverableExtractionError("Request timed out while calling model"), true);
	assert.equal(isRecoverableExtractionError("Service unavailable (502)"), true);
});

test("non-recoverable failures are not retried", () => {
	assert.equal(isRecoverableExtractionError("Invalid role in request payload"), false);
});
