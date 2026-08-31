export type Field =
  | { type: "string"; description?: string; optional?: boolean; enum?: string[] }
  | { type: "number"; description?: string; optional?: boolean };

export type Fields = Record<string, Field>;

export function str(
  description?: string,
  { optional = false, enum: values }: { optional?: boolean; enum?: string[] } = {},
): Field {
  return { type: "string", description, optional, ...(values ? { enum: values } : {}) };
}

export function num(description?: string, { optional = false }: { optional?: boolean } = {}): Field {
  return { type: "number", description, optional };
}

export type Validation =
  | { success: true; data: Record<string, unknown> }
  | { success: false; messages: string[] };

export function validate(fields: Fields, input: unknown): Validation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, messages: ["arguments must be an object"] };
  }
  const raw = input as Record<string, unknown>;
  const messages: string[] = [];
  const data: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    const present = key in raw;
    if (!present) {
      if (!field.optional) messages.push(`${key} is required`);
      continue;
    }
    const value = raw[key];
    if (field.type === "string") {
      if (typeof value !== "string") {
        messages.push(`${key} must be a string`);
        continue;
      }
      if (field.enum && !field.enum.includes(value)) {
        messages.push(`${key} must be one of: ${field.enum.join(", ")}`);
        continue;
      }
    } else if (typeof value !== "number") {
      messages.push(`${key} must be a number`);
      continue;
    }
    data[key] = value;
  }
  return messages.length > 0 ? { success: false, messages } : { success: true, data };
}

export function toJsonSchema(fields: Fields): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(fields)) {
    const property: Record<string, unknown> = { type: field.type };
    if (field.type === "string" && field.enum) property.enum = field.enum;
    if (field.description) property.description = field.description;
    if (!field.optional) required.push(key);
    properties[key] = property;
  }
  return { type: "object", properties, required, additionalProperties: false };
}