#!/usr/bin/env node
import fs from "fs";
import path from "path";

const DEFAULT_VAULT =
  "/Users/fabiofsilveira/t/2026-obsidian-migration/vaults/TESTES-obsidian-ffs-CLONE-TESTES";

const vaultPath = path.resolve(process.argv[2] ?? DEFAULT_VAULT);
const qaRoot = path.join(vaultPath, "QA");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function touchAttachment(filePath) {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `fixture: ${path.basename(filePath)}\n`, "utf8");
  }
}

function relLink(fromFile, targetFile) {
  return path.relative(path.dirname(fromFile), targetFile).split(path.sep).join("/");
}

function resetScenario(name) {
  const scenarioPath = path.join(qaRoot, name);
  fs.rmSync(scenarioPath, { recursive: true, force: true });
  ensureDir(scenarioPath);
  return scenarioPath;
}

function scenarioT1() {
  const root = resetScenario("T1");
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  ensureDir(a);
  ensureDir(b);

  const note = path.join(a, "Nota.md");
  const img = path.join(a, "img.png");
  const pdf = path.join(a, "doc.pdf");

  touchAttachment(img);
  touchAttachment(pdf);

  writeTextFile(
    note,
    `# T1\n\n![[${path.basename(img)}]]\n\n[Documento](${path.basename(pdf)})\n`
  );
}

function scenarioT2() {
  const root = resetScenario("T2");
  const a = path.join(root, "A");
  ensureDir(a);

  const note = path.join(a, "Nota.md");
  const img = path.join(a, "img.png");

  touchAttachment(img);
  writeTextFile(note, `# T2\n\n![[${path.basename(img)}]]\n`);
}

function scenarioT3() {
  const root = resetScenario("T3");
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  ensureDir(a);
  ensureDir(b);

  const note = path.join(a, "Nota.md");
  writeTextFile(note, "# T3\n\nSem anexos.\n");
}

function scenarioT4() {
  const root = resetScenario("T4");
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  const globalDir = path.join(root, "Global");
  ensureDir(a);
  ensureDir(b);
  ensureDir(globalDir);

  const note = path.join(a, "Nota.md");
  const globalImg = path.join(globalDir, "img.png");
  touchAttachment(globalImg);

  const link = relLink(note, globalImg);
  writeTextFile(note, `# T4\n\n![fora](${link})\n`);
}

function scenarioT5() {
  const root = resetScenario("T5");
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  const c = path.join(root, "C");
  ensureDir(a);
  ensureDir(b);
  ensureDir(c);

  const shared = path.join(a, "img.png");
  const note1 = path.join(a, "Nota1.md");
  const note2 = path.join(c, "Nota2.md");
  touchAttachment(shared);

  writeTextFile(note1, `# T5 Nota1\n\n![[${path.basename(shared)}]]\n`);
  writeTextFile(note2, `# T5 Nota2\n\n![shared](${relLink(note2, shared)})\n`);
}

function scenarioT6() {
  const root = resetScenario("T6");
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  ensureDir(a);
  ensureDir(b);

  const srcImg = path.join(a, "img.png");
  const dstImg = path.join(b, "img.png");
  const note = path.join(a, "Nota.md");
  touchAttachment(srcImg);
  touchAttachment(dstImg);

  writeTextFile(note, `# T6\n\n![[${path.basename(srcImg)}]]\n`);
}

function scenarioT7() {
  const root = resetScenario("T7");
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  ensureDir(a);
  ensureDir(b);

  const note = path.join(a, "Nota.md");
  writeTextFile(
    note,
    "# T7\n\nLink quebrado markdown: [missing](arquivo-inexistente.pdf)\n\nWiki quebrado: ![[imagem-inexistente.png]]\n"
  );
}

function scenarioT8() {
  const root = resetScenario("T8");
  const a = path.join(root, "A");
  ensureDir(a);

  const note = path.join(a, "Nota.md");
  const img = path.join(a, "img.png");
  touchAttachment(img);
  writeTextFile(note, `# T8\n\n![[${path.basename(img)}]]\n`);
}

function scenarioT9() {
  const root = resetScenario("T9");
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  ensureDir(a);
  ensureDir(b);

  const note = path.join(a, "Nota.md");
  const img = path.join(a, "img.png");
  const pdf = path.join(a, "doc.pdf");
  touchAttachment(img);
  touchAttachment(pdf);

  writeTextFile(
    note,
    `# T9\n\nWiki:\n![[${path.basename(img)}]]\n\nMarkdown:\n[Documento](${path.basename(pdf)})\n`
  );
}

function scenarioT10() {
  const root = resetScenario("T10");
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  ensureDir(a);
  ensureDir(b);

  const note = path.join(a, "Nota.md");
  const img = path.join(a, "imagem ação ã.png");
  const pdf = path.join(a, "café.pdf");
  touchAttachment(img);
  touchAttachment(pdf);

  writeTextFile(
    note,
    `# T10\n\n![[${path.basename(img)}]]\n\n[Arquivo](${path.basename(pdf)})\n`
  );
}

function main() {
  ensureDir(qaRoot);
  scenarioT1();
  scenarioT2();
  scenarioT3();
  scenarioT4();
  scenarioT5();
  scenarioT6();
  scenarioT7();
  scenarioT8();
  scenarioT9();
  scenarioT10();

  console.log(`Fixtures generated at: ${qaRoot}`);
}

main();
