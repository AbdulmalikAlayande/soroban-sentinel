import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const README_PT_PATH = path.join(PROJECT_ROOT, "README.pt.md");
const README_EN_PATH = path.join(PROJECT_ROOT, "README.md");

function readPtReadme(): string {
    return fs.readFileSync(README_PT_PATH, "utf-8");
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

describe("README.pt.md existence", () => {
    it("README.pt.md exists in the project root", () => {
        expect(fs.existsSync(README_PT_PATH)).toBe(true);
    });

    it("README.pt.md is a readable file with content", () => {
        const content = readPtReadme();
        expect(content.length).toBeGreaterThan(100);
    });
});

describe("language switcher", () => {
    let ptContent: string;
    let enContent: string;

    beforeAll(() => {
        ptContent = readPtReadme();
        enContent = readEnReadme();
    });

    it("README.pt.md contains a link back to README.md (English)", () => {
        expect(ptContent).toMatch(/README\.md/);
    });

    it("README.md contains a link to README.pt.md (Portuguese)", () => {
        expect(enContent).toMatch(/README\.pt\.md/);
    });
});

describe("Brazilian Portuguese note", () => {
    let ptContent: string;

    beforeAll(() => {
        ptContent = readPtReadme();
    });

    it("contains a note identifying the translation as Brazilian Portuguese", () => {
        const lower = ptContent.toLowerCase();
        const hasPtBrIndicator =
            lower.includes("português") &&
            (lower.includes("brasileiro") || lower.includes("brasil") || lower.includes("pt-br"));
        expect(hasPtBrIndicator).toBe(true);
    });
});

describe("section coverage", () => {
    let ptContent: string;

    beforeAll(() => {
        ptContent = readPtReadme();
    });

    describe("top-level sections", () => {
        it("has the title 'Sorokeep'", () => {
            expect(ptContent).toMatch(/Sorokeep/i);
        });

        it("has a 'Por Que Isso Existe' or equivalent section (Why This Exists)", () => {
            const patterns = [
                /por\s+qu[eê]\s+isso\s+existe/i,
                /por\s+qu[eê]\s+isso\s+exist[eê]/i,
                /por\s+que\s+isso\s+existe/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Funcionalidades' or equivalent section (Features)", () => {
            const patterns = [
                /funcionalidades/i,
                /recurso/i,
                /carater[ií]stica/i,
                /caracter[ií]stica/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has an 'Instalação' or equivalent section (Install)", () => {
            const patterns = [
                /instala[cç][aã]o/i,
                /instalar/i,
                /como\s+instalar/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Início Rápido' or equivalent section (Quick Start)", () => {
            const patterns = [
                /in[ií]cio\s+rápido/i,
                /come[çc]o\s+rápido/i,
                /primeiros\s+passos/i,
                /quick\s+start/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Comandos' or equivalent section (Commands)", () => {
            const patterns = [
                /comandos/i,
                /comando/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has an 'Alertas' or equivalent section (Alerting)", () => {
            const patterns = [
                /alertas/i,
                /alertar/i,
                /sistema\s+de\s+alerta/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Como Funciona' or equivalent section (How It Works)", () => {
            const patterns = [
                /como\s+funciona/i,
                /como\s+funcion/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Estrutura do Projeto' or equivalent section (Project Structure)", () => {
            const patterns = [
                /estrutura\s+do\s+projeto/i,
                /estrutura\s+do\s+projeto/i,
                /organiza[cç][aã]o\s+do\s+projeto/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Stack Tecnológica' or equivalent section (Tech Stack)", () => {
            const patterns = [
                /stack\s+tecnol[oó]gica/i,
                /tecnologias/i,
                /stack\s+tecnico/i,
                /pilha\s+tecnol[oó]gica/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Testes' or equivalent section (Testing)", () => {
            const patterns = [
                /testes/i,
                /teste/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Perguntas Frequentes' or equivalent section (FAQ)", () => {
            const patterns = [
                /perguntas\s+frequentes/i,
                /faq/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Roadmap' or equivalent section", () => {
            expect(ptContent).toMatch(/roadmap/i);
        });

        it("has a 'Contribuir' or equivalent section (Contributing)", () => {
            const patterns = [
                /contribu/i,
                /como\s+contribuir/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has a 'Licença' or equivalent section (License)", () => {
            const patterns = [
                /licen[çc]a/i,
                /license/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("has an 'Autor' or equivalent section (Author)", () => {
            const patterns = [
                /autor/i,
                /autora/i,
                /autor[a]?s/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });
    });

    describe("Commands subsections", () => {
        it("documents the 'watch' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+watch/i);
        });

        it("documents the 'status' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+status/i);
        });

        it("documents the 'daemon' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+daemon/i);
        });

        it("documents the 'alerts' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+alerts/i);
        });

        it("documents the 'guard' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+guard/i);
        });

        it("documents the 'costs' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+costs/i);
        });

        it("documents the 'restore' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+restore/i);
        });

        it("documents the 'resources' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+resources/i);
        });

        it("documents the 'budget' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+budget/i);
        });

        it("documents the 'channels' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+channels/i);
        });

        it("documents the 'inspect' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+inspect/i);
        });

        it("documents the 'check' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+check/i);
        });

        it("documents the 'db' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+db/i);
        });

        it("documents the 'completion' command", () => {
            expect(ptContent).toMatch(/sorokeep\s+completion/i);
        });
    });

    describe("Alerting subsections", () => {
        it("describes the alert lifecycle", () => {
            const patterns = [
                /ciclo\s+de\s+vida/i,
                /lifecycle/i,
                /vida\s+do\s+alerta/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("describes severity levels", () => {
            const patterns = [
                /n[ií]veis\s+de\s+gravidade/i,
                /severidade/i,
                /gravidade/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("describes webhook delivery", () => {
            const patterns = [
                /entrega\s+via\s+webhook/i,
                /entrega.*webhook/i,
                /webhook.*entrega/i,
                /delivery.*webhook/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("describes webhook signing", () => {
            const patterns = [
                /assinatura\s+de\s+webhook/i,
                /assinatura.*webhook/i,
                /webhook.*signing/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("describes Slack delivery", () => {
            const patterns = [
                /entrega\s+via\s+slack/i,
                /slack.*entrega/i,
                /slack.*delivery/i,
                /entrega.*slack/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("describes retry policy", () => {
            const patterns = [
                /pol[ií]tica\s+de\s+retentativa/i,
                /retentativa/i,
                /retry/i,
                /nova\s+tentativa/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });
    });

    describe("How It Works subsections", () => {
        it("describes the daemon cycle", () => {
            const patterns = [
                /ciclo\s+do\s+daemon/i,
                /ciclo.*daemon/i,
                /daemon.*cycle/i,
                /ciclo\s+do\s+processo/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("describes storage", () => {
            const patterns = [
                /armazenamento/i,
                /storage/i,
                /banco\s+de\s+dados/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("describes configuration", () => {
            const patterns = [
                /configura[cç][aã]o/i,
                /config/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });
    });

    describe("FAQ questions", () => {
        it("covers the TypeScript vs Rust question", () => {
            const patterns = [
                /typescript.*rust/i,
                /rust.*typescript/i,
                /por\s+que.*typescript/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("covers the secret key storage question", () => {
            const patterns = [
                /chave\s+secreta/i,
                /secret\s+key/i,
                /chave\s+privada/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("covers the daemon crash question", () => {
            const patterns = [
                /crash/i,
                /travar/i,
                /parar\s+inesperadamente/i,
                /falha\s+do\s+daemon/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });

        it("covers the supported networks question", () => {
            const patterns = [
                /redes?\s+suportada/i,
                /network.*support/i,
                /testnet.*mainnet/i,
            ];
            expect(patterns.some((p) => p.test(ptContent))).toBe(true);
        });
    });

    describe("code blocks remain in English", () => {
        it("contains the sorokeep watch example command", () => {
            expect(ptContent).toMatch(/sorokeep\s+watch\s+CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC/);
        });

        it("contains the sorokeep daemon command", () => {
            expect(ptContent).toMatch(/sorokeep\s+daemon\s+--network\s+testnet/);
        });

        it("contains npm install commands", () => {
            expect(ptContent).toMatch(/npm\s+install/);
        });

        it("contains git clone command", () => {
            expect(ptContent).toMatch(/git\s+clone/);
        });

        it("contains the Stellar SDK import example", () => {
            expect(ptContent).toMatch(/@stellar\/stellar-sdk/);
        });

        it("contains the architecture ASCII diagram", () => {
            expect(ptContent).toMatch(/Stellar Network/);
        });
    });

    describe("content parity with English README", () => {
        it("has at least as many headings as the English README", () => {
            const enContent = readEnReadme();
            const enHeadings = countHeadings(enContent);
            const ptHeadings = countHeadings(ptContent);
            expect(ptHeadings).toBeGreaterThanOrEqual(enHeadings);
        });

        it("preserves all option table headers (Option | Description | Default)", () => {
            const optionTables = ptContent.match(/\|.*Op[cç][aã]o.*\|.*Descri[cç][aã]o.*\|.*Padr[aã]o/gi);
            expect(optionTables).not.toBeNull();
            expect(optionTables!.length).toBeGreaterThanOrEqual(3);
        });
    });
});
