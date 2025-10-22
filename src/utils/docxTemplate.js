import PizZip from "pizzip";

function nextNonTagVisibleChar(xml, startIndex) {
  const len = xml.length;
  let insideTag = false;
  for (let i = startIndex; i < len; i += 1) {
    const ch = xml[i];
    if (ch === "<") {
      insideTag = true;
      continue;
    }
    if (insideTag) {
      if (ch === ">") insideTag = false;
      continue;
    }
    if (/\s/.test(ch)) continue;
    return ch;
  }
  return null;
}

export function sanitizeDocxXml(xml = "") {
  if (!xml) return "";
  return xml
    .replace(/<w:proofErr[^>]*\/>/g, "")
    .replace(/<w:proofErr[^>]*>.*?<\/w:proofErr>/gs, "")
    .replace(/\u200b/g, "")
    .replace(/{{{+/g, "{{")
    .replace(/}}}+/g, "}}")
    .replace(/\{\{\s+/g, "{{")
    .replace(/\s+\}\}/g, "}}")
    .replace(/\{\s+/g, "{")
    .replace(/\s+\}/g, "}");
}

export function normalizeDocxPlaceholders(xml) {
  if (!xml || typeof xml !== "string" || xml.indexOf("{") === -1) return xml;

  const len = xml.length;
  let result = "";
  let i = 0;

  while (i < len) {
    const ch = xml[i];
    if (ch === "{") {
      let raw = "";
      let openCount = 0;
      let closeCount = 0;
      let j = i;
      let insideTag = false;

      while (j < len) {
        const current = xml[j];
        raw += current;

        if (current === "<") insideTag = true;
        else if (current === ">") insideTag = false;
        else if (!insideTag) {
          if (current === "{") {
            openCount += 1;
          } else if (current === "}") {
            closeCount += 1;
            if (openCount === 1 && closeCount === 1) {
              const nextVisible = nextNonTagVisibleChar(xml, j + 1);
              if (nextVisible !== "}") {
                j += 1;
                break;
              }
            }
            if (openCount >= 2 && closeCount >= 2) {
              j += 1;
              break;
            }
          }
        }

        j += 1;
      }

      const isDouble = openCount >= 2 && closeCount >= 2;
      const isSingle = !isDouble && openCount >= 1 && closeCount >= 1;

      if (isDouble || isSingle) {
        const plain = raw.replace(/<[^>]+>/g, "");
        const sliceStart = isDouble ? 2 : 1;
        const sliceEnd = isDouble ? -2 : -1;
        if (plain.length > Math.abs(sliceEnd) + sliceStart) {
          const inner = plain.slice(sliceStart, sliceEnd).replace(/\s+/g, " ").trim();
          if (inner) {
            result += `{{${inner}}}`;
            i = j;
            continue;
          }
        }
      }
    }

    result += ch;
    i += 1;
  }

  return result;
}

function normalizeDelimitersOption(delims) {
  if (!delims) return null;
  if (typeof delims === "string") {
    const type = delims === "single" ? "single" : "double";
    return type === "single"
      ? { start: "{", end: "}", type }
      : { start: "{{", end: "}}", type };
  }
  if (typeof delims === "object" && delims.start && delims.end) {
    const type = delims.start === "{" && delims.end === "}" ? "single" : "double";
    return { start: delims.start, end: delims.end, type };
  }
  return null;
}

export function detectDocxDelimiters(xml) {
  if (!xml) return { start: "{{", end: "}}", type: "double" };
  const hasDouble = /{{[#\/A-Za-z0-9_.][^}]*}}/.test(xml);
  if (hasDouble) return { start: "{{", end: "}}", type: "double" };
  const hasSingle = /{[#\/A-Za-z0-9_.][^}]*}/.test(xml);
  if (hasSingle) return { start: "{", end: "}", type: "single" };
  return { start: "{{", end: "}}", type: "double" };
}

export function convertToDoubleDelimiters(xml, delimiters) {
  const info = normalizeDelimitersOption(delimiters) || detectDocxDelimiters(xml);
  if (info.type !== "single") return xml;
  return xml
    .replace(/\{#([a-zA-Z0-9_.]+)\}/g, "{{#$1}}")
    .replace(/\{\/([a-zA-Z0-9_.]+)\}/g, "{{/$1}}")
    .replace(/\{([a-zA-Z0-9_.]+)\}/g, "{{$1}}");
}

export function escapeXml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolvePath(context, key) {
  if (!key) return undefined;
  if (Object.prototype.hasOwnProperty.call(context, key)) {
    return context[key];
  }
  const parts = key.split(".");
  let current = context;
  for (const part of parts) {
    if (current == null) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function applyDocxTemplate(xml, context = {}) {
  let output = xml;

  const loopRegex = /{{#([a-zA-Z0-9_.]+)}}([\s\S]*?){{\/\1}}/g;
  output = output.replace(loopRegex, (match, key, inner) => {
    const rows = resolvePath(context, key);
    if (!Array.isArray(rows) || rows.length === 0) {
      return "";
    }
    return rows
      .map((row) => applyDocxTemplate(inner, { ...context, ...row }))
      .join("");
  });

  output = output.replace(/{{([a-zA-Z0-9_.]+)}}/g, (match, key) => {
    const value = resolvePath(context, key);
    if (value === null || value === undefined) return "";
    if (typeof value === "number" || typeof value === "bigint") {
      return escapeXml(String(value));
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    return escapeXml(String(value));
  });

  return output;
}

export function preprocessDocxXml(xml) {
  return normalizeDocxPlaceholders(sanitizeDocxXml(xml));
}

export function renderDocxBuffer(templateBuffer, data = {}, options = {}) {
  const zip = new PizZip(templateBuffer);
  const docXmlPath = options.docXmlPath || "word/document.xml";
  const entry = zip.file(docXmlPath);
  if (!entry) {
    throw new Error(`missing_doc_part:${docXmlPath}`);
  }

  let xml = preprocessDocxXml(entry.asText());
  const forced = normalizeDelimitersOption(options.forceDelimiters);
  const delims = forced || detectDocxDelimiters(xml);
  xml = convertToDoubleDelimiters(xml, delims);
  xml = applyDocxTemplate(xml, data);
  xml = xml.replace(/{{[^}]+}}/g, "");

  zip.file(docXmlPath, xml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
