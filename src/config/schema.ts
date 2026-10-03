import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../../schema/lsp.schema.json" with { type: "json" };

export interface ValidationResult {
	ok: boolean;
	errors: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

export function validateSourceConfig(value: unknown): ValidationResult {
	if (validate(value)) return { ok: true, errors: [] };
	return {
		ok: false,
		errors: (validate.errors ?? []).map((error) => {
			const path = error.instancePath || "/";
			return `${path}: ${error.message ?? "is invalid"}`;
		}),
	};
}
