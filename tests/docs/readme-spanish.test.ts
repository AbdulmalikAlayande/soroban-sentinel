import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const README_ES_PATH = path.join(PROJECT_ROOT, "README.es.md");
const README_EN_PATH = path.join(PROJECT_ROOT, "README.md");

function readEsReadme(): string {
    return fs.readFileSync(README_ES_PATH, "utf-8");
}

function readEnReadme(): string {
    return fs.readFileSync(README_EN_PATH, "utf-8");
}

/**
 * Counts markdown headings, excluding fenced code blocks — a shell comment
 * like `# do the thing` inside a ```bash block is not a heading, but the
 * naive `/^#{1,4} /gm` pattern can't tell the difference.
 */
function countHeadings(markdown: string): number {
    const withoutCodeFences = markdown.replace(/```[\s\S]*?```/g, "");
    return (withoutCodeFences.match(/^#{1,4} /gm) || []).length;
}

describe("README.es.md existence", () => {
    it("README.es.md exists in the project root", () => {
        expect(fs.existsSync(README_ES_PATH)).toBe(true);
    });

    it("README.es.md is a readable file with content", () => {
        const content = readEsReadme();
        expect(content.length).toBeGreaterThan(100);
    });
});

describe("language switcher", () => {
    let esContent: string;
    let enContent: string;

    beforeAll(() => {
        esContent = readEsReadme();
        enContent = readEnReadme();
    });

    it("README.es.md contains a link back to README.md (English)", () => {
        expect(esContent).toMatch(/README\.md/);
    });

    it("README.md contains a link to README.es.md (Spanish)", () => {
        expect(enContent).toMatch(/README\.es\.md/);
    });
});

describe("section coverage", () => {
    let esContent: string;

    beforeAll(() => {
        esContent = readEsReadme();
    });

    describe("top-level sections", () => {
        it("has the title 'Sorokeep'", () => {
            expect(esContent).toMatch(/Sorokeep/i);
        });

        it("has a 'Por qué existe esto' or equivalent section (Why This Exists)", () => {
            expect(esContent).toMatch(/por\s+qu[eé]\s+exist/i);
        });

        it("has a 'Características' or equivalent section (Features)", () => {
            const patterns = [/caracter[ií]sticas/i, /funcionalidades/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has an 'Instalación' or equivalent section (Install)", () => {
            const patterns = [/instalaci[oó]n/i, /instalar/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has an 'Inicio Rápido' or equivalent section (Quick Start)", () => {
            const patterns = [/inicio\s+r[aá]pido/i, /primeros\s+pasos/i, /quick\s+start/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has a 'Comandos' or equivalent section (Commands)", () => {
            expect(esContent).toMatch(/comandos?/i);
        });

        it("has an 'Alertas' or equivalent section (Alerting)", () => {
            const patterns = [/alertas/i, /alertar/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has a 'Cómo Funciona' or equivalent section (How It Works)", () => {
            expect(esContent).toMatch(/c[oó]mo\s+funciona/i);
        });

        it("has an 'Estructura del Proyecto' or equivalent section (Project Structure)", () => {
            const patterns = [/estructura\s+del\s+proyecto/i, /organizaci[oó]n\s+del\s+proyecto/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has a 'Pila Tecnológica' or equivalent section (Tech Stack)", () => {
            const patterns = [/pila\s+tecnol[oó]gica/i, /stack\s+tecnol[oó]gico/i, /tecnolog[ií]as/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has a 'Pruebas' or equivalent section (Testing)", () => {
            const patterns = [/pruebas/i, /testing/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has a 'Preguntas Frecuentes' or equivalent section (FAQ)", () => {
            const patterns = [/preguntas\s+frecuentes/i, /faq/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has a 'Hoja de Ruta' or equivalent section (Roadmap)", () => {
            const patterns = [/hoja\s+de\s+ruta/i, /roadmap/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has a 'Contribución' or equivalent section (Contributing)", () => {
            expect(esContent).toMatch(/contribuci[oó]n|contribuir/i);
        });

        it("has a 'Licencia' or equivalent section (License)", () => {
            const patterns = [/licencia/i, /license/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("has an 'Autor' or equivalent section (Author)", () => {
            expect(esContent).toMatch(/autor/i);
        });
    });

    describe("Commands subsections", () => {
        const commands = [
            "watch", "status", "daemon", "alerts", "guard", "costs",
            "restore", "resources", "budget", "channels", "inspect",
            "check", "db", "completion", "contracts",
        ];

        for (const cmd of commands) {
            it(`documents the '${cmd}' command`, () => {
                expect(esContent).toMatch(new RegExp(`sorokeep\\s+${cmd}`, "i"));
            });
        }

        it("documents global options", () => {
            const patterns = [/opciones\s+globales/i, /global\s+options/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });
    });

    describe("Alerting subsections", () => {
        it("describes the supported channels comparison", () => {
            const patterns = [/comparaci[oó]n\s+de\s+canales/i, /canales\s+compatibles/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("describes the alert lifecycle", () => {
            const patterns = [/ciclo\s+de\s+vida/i, /lifecycle/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("describes severity levels", () => {
            const patterns = [/niveles\s+de\s+severidad/i, /severidad/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("describes webhook delivery", () => {
            expect(esContent).toMatch(/webhook/i);
        });

        it("describes webhook signing", () => {
            const patterns = [/firma\s+de\s+webhook/i, /webhook.*signing/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("describes Slack delivery", () => {
            expect(esContent).toMatch(/slack/i);
        });

        it("describes retry policy", () => {
            const patterns = [/pol[ií]tica\s+de\s+reintentos/i, /reintentos/i, /retry/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });
    });

    describe("How It Works subsections", () => {
        it("describes the daemon cycle", () => {
            const patterns = [/ciclo\s+del\s+demonio/i, /daemon.*cycle/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("describes storage", () => {
            const patterns = [/almacenamiento/i, /storage/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("describes configuration", () => {
            const patterns = [/configuraci[oó]n/i, /config/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });
    });

    describe("FAQ questions", () => {
        it("covers the TypeScript vs Rust question", () => {
            const patterns = [/typescript.*rust/i, /rust.*typescript/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("covers the secret key storage question", () => {
            const patterns = [/clave\s+secreta/i, /secret\s+key/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("covers the daemon crash question", () => {
            const patterns = [/falla.*demonio/i, /demonio.*falla/i, /crash/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });

        it("covers the supported networks question", () => {
            const patterns = [/redes?\s+(son\s+)?compatibles/i, /testnet.*mainnet/i];
            expect(patterns.some((p) => p.test(esContent))).toBe(true);
        });
    });

    describe("code blocks remain in English", () => {
        it("contains the sorokeep watch example command", () => {
            expect(esContent).toMatch(/sorokeep\s+watch\s+CDLZFC3S/);
        });

        it("contains the sorokeep daemon command", () => {
            expect(esContent).toMatch(/sorokeep\s+daemon\s+--network\s+testnet/);
        });

        it("contains npm install commands", () => {
            expect(esContent).toMatch(/npm\s+install/);
        });

        it("contains git clone command", () => {
            expect(esContent).toMatch(/git\s+clone/);
        });
    });

    describe("content parity with English README", () => {
        it("has at least as many headings as the English README", () => {
            const enContent = readEnReadme();
            const enHeadings = countHeadings(enContent);
            const esHeadings = countHeadings(esContent);
            expect(esHeadings).toBeGreaterThanOrEqual(enHeadings);
        });
    });
});
