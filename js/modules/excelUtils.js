// js/modules/excelUtils.js — ExcelJS (formatação completa)

const ARGB = {
  PRIMARY:    "FF009BC1",
  WHITE:      "FFFFFFFF",
  ALT:        "FFEBF7FB",
  EXAMPLE_FG: "FF94A3B8",
  EXAMPLE_BG: "FFF8FAFC",
  LOCKED_FG:  "FF64748B",
  LOCKED_BG:  "FFF1F5F9",
  TOTAL_BG:   "FFD0EEF7",
  BORDER:     "FFCBD5E1",
  SECAO_BG:   "FFEBF7FB",
};

function borda() {
  const b = { style: "thin", color: { argb: ARGB.BORDER } };
  return { top: b, bottom: b, left: b, right: b };
}

function aplicarHeader(cell, valor) {
  cell.value     = valor;
  cell.font      = { name: "Calibri", size: 11, bold: true, color: { argb: ARGB.WHITE } };
  cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.PRIMARY } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border    = borda();
}

function aplicarNormal(cell, valor, alt = false) {
  cell.value     = valor;
  cell.font      = { name: "Calibri", size: 11 };
  cell.fill      = alt
    ? { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.ALT } }
    : { type: "pattern", pattern: "none" };
  cell.alignment = { vertical: "middle" };
  cell.border    = borda();
}

function aplicarExemplo(cell, valor) {
  cell.value     = valor;
  cell.font      = { name: "Calibri", size: 10, italic: true, color: { argb: ARGB.EXAMPLE_FG } };
  cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.EXAMPLE_BG } };
  cell.alignment = { vertical: "middle" };
  cell.border    = borda();
}

function aplicarBloqueado(cell, valor) {
  cell.value     = valor;
  cell.font      = { name: "Calibri", size: 10, color: { argb: ARGB.LOCKED_FG } };
  cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.LOCKED_BG } };
  cell.alignment = { vertical: "middle" };
  cell.border    = borda();
}

function aplicarTotal(cell, valor, moeda = false) {
  cell.value     = valor;
  cell.font      = { name: "Calibri", size: 11, bold: true };
  cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.TOTAL_BG } };
  cell.alignment = { vertical: "middle", horizontal: moeda ? "right" : "left" };
  cell.border    = borda();
  if (moeda) cell.numFmt = '"R$"#,##0.00';
}

function aplicarMoeda(cell, valor, alt = false) {
  cell.value     = valor;
  cell.font      = { name: "Calibri", size: 11 };
  cell.fill      = alt
    ? { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.ALT } }
    : { type: "pattern", pattern: "none" };
  cell.numFmt    = '"R$"#,##0.00';
  cell.alignment = { vertical: "middle", horizontal: "right" };
  cell.border    = borda();
}

function adicionarAbaInstrucoes(wb, titulo, itens) {
  const ws = wb.addWorksheet("Instruções");
  ws.views   = [{ showGridLines: false }];
  ws.columns = [{ width: 26 }, { width: 64 }];

  const tRow = ws.addRow([titulo, ""]);
  ws.mergeCells(`A${tRow.number}:B${tRow.number}`);
  const tc = tRow.getCell(1);
  tc.font      = { name: "Calibri", size: 13, bold: true, color: { argb: ARGB.WHITE } };
  tc.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.PRIMARY } };
  tc.alignment = { horizontal: "center", vertical: "middle" };
  tRow.height  = 26;

  itens.forEach(item => {
    if (item.tipo === "secao") {
      const row = ws.addRow([item.texto, ""]);
      ws.mergeCells(`A${row.number}:B${row.number}`);
      const c = row.getCell(1);
      c.font      = { name: "Calibri", size: 11, bold: true, color: { argb: ARGB.PRIMARY } };
      c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB.SECAO_BG } };
      c.alignment = { vertical: "middle" };
      row.height  = 20;
    } else {
      const row = ws.addRow([item.campo || "", item.desc || ""]);
      row.getCell(1).font      = { name: "Calibri", size: 10, bold: true };
      row.getCell(2).font      = { name: "Calibri", size: 10 };
      row.getCell(1).alignment = { vertical: "middle" };
      row.getCell(2).alignment = { vertical: "middle", wrapText: true };
      row.height = 18;
    }
  });
}

async function downloadWorkbook(wb, filename) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function nomeArquivo(base) {
  const d  = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${base}_${d.getFullYear()}-${mm}.xlsx`;
}

export function hojeFormatado() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

export function parseDateImport(val) {
  if (!val && val !== 0) return "";
  const str = String(val).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split("/");
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (typeof val === "number" && val > 1000) {
    return new Date(Math.round((val - 25569) * 86400 * 1000)).toISOString().split("T")[0];
  }
  return str;
}

export async function gerarModeloAtletas() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Atletas Energisa";
  const ws = wb.addWorksheet("Cadastro");
  ws.views = [{ showGridLines: false }];

  ws.columns = [
    { width: 32 }, { width: 34 }, { width: 14 }, { width: 18 },
    { width: 22 }, { width: 14 }, { width: 26 }, { width: 10 },
  ];

  const hRow = ws.addRow([
    "Nome Completo *", "E-mail Corporativo", "Sexo", "Data Nascimento",
    "Localidade", "Ano Entrada", "Equipe *", "Ativo"
  ]);
  hRow.height = 22;
  hRow.eachCell(cell => aplicarHeader(cell, cell.value));

  const exRow = ws.addRow([
    "João Silva Santos", "joao.silva@energisa.com.br", "Masculino",
    hojeFormatado(), "São Paulo", new Date().getFullYear(), "Bicicleta", "Sim"
  ]);
  exRow.height = 18;
  exRow.eachCell(cell => aplicarExemplo(cell, cell.value));

  for (let r = 3; r <= 1002; r++) {
    ws.getCell(r, 3).dataValidation = {
      type: "list", allowBlank: true, formulae: ['"Masculino,Feminino"'],
      showErrorMessage: true, errorTitle: "Valor inválido", error: "Selecione Masculino ou Feminino"
    };
    ws.getCell(r, 7).dataValidation = {
      type: "list", allowBlank: true, formulae: ['"Bicicleta,Corrida,Fila - Bicicleta,Fila - Corrida"'],
      showErrorMessage: true, errorTitle: "Equipe inválida", error: "Selecione uma equipe da lista"
    };
    ws.getCell(r, 8).dataValidation = {
      type: "list", allowBlank: true, formulae: ['"Sim,Não"'],
      showErrorMessage: true, errorTitle: "Valor inválido", error: "Selecione Sim ou Não"
    };
  }

  ws.autoFilter = { from: "A1", to: "H1" };

  adicionarAbaInstrucoes(wb, "Instruções — Modelo de Atletas", [
    { tipo: "secao", texto: "Campos obrigatórios (marcados com *)" },
    { campo: "Nome Completo *", desc: "Nome completo do atleta. Obrigatório." },
    { campo: "Equipe *",        desc: "Selecione da lista: Bicicleta, Corrida, Fila - Bicicleta ou Fila - Corrida." },
    { tipo: "secao", texto: "Campos opcionais" },
    { campo: "E-mail Corporativo", desc: "E-mail da empresa (ex: nome@energisa.com.br)." },
    { campo: "Sexo",               desc: "Selecione da lista: Masculino ou Feminino." },
    { campo: "Data Nascimento",    desc: "Formato DD/MM/AAAA — ex: 15/03/1990." },
    { campo: "Localidade",         desc: "Cidade ou regional do atleta." },
    { campo: "Ano Entrada",        desc: "Ano em que o atleta entrou no programa. Padrão: ano atual." },
    { campo: "Ativo",              desc: "Selecione Sim ou Não. Padrão: Sim." },
  ]);

  await downloadWorkbook(wb, nomeArquivo("Modelo_Cadastro_Atletas"));
}

export async function gerarModeloLancamentos(atletasAlvo, mod) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Atletas Energisa";
  const ws = wb.addWorksheet("Lançamentos");
  ws.views = [{ showGridLines: false }];

  ws.columns = [
    { width: 28 }, { width: 30 }, { width: 18 },
    { width: 20 }, { width: 16 }, { width: 36 }, { width: 16 },
  ];

  const hRow = ws.addRow([
    "ID_Oculto (NÃO ALTERAR)", "Atleta", "Equipe",
    "Pontos a Adicionar", "KM Percorridos", "Descrição / Evento", "Data"
  ]);
  hRow.height = 22;
  hRow.eachCell(cell => aplicarHeader(cell, cell.value));

  atletasAlvo.forEach((a, i) => {
    const alt = i % 2 === 1;
    const row = ws.addRow([a.id, a.nome, a.equipe, "", "", "", hojeFormatado()]);
    row.height = 18;
    aplicarBloqueado(row.getCell(1), a.id);
    aplicarBloqueado(row.getCell(2), a.nome);
    aplicarBloqueado(row.getCell(3), a.equipe);
    aplicarNormal(row.getCell(4), "", alt);
    aplicarNormal(row.getCell(5), "", alt);
    aplicarNormal(row.getCell(6), "", alt);
    aplicarNormal(row.getCell(7), hojeFormatado(), alt);
    [4, 5].forEach(c => {
      row.getCell(c).dataValidation = {
        type: "decimal", operator: "greaterThanOrEqual", formulae: [0],
        allowBlank: true, showErrorMessage: true,
        errorTitle: "Valor inválido", error: "Informe apenas números."
      };
    });
  });

  ws.autoFilter = { from: "A1", to: "G1" };

  adicionarAbaInstrucoes(wb, `Instruções — Lançamentos ${mod}`, [
    { tipo: "secao", texto: "Colunas bloqueadas (não alterar)" },
    { campo: "ID_Oculto",  desc: "Identificador interno do atleta. NÃO altere esta coluna." },
    { campo: "Atleta",     desc: "Nome do atleta. Preenchido automaticamente." },
    { campo: "Equipe",     desc: "Equipe do atleta. Preenchido automaticamente." },
    { tipo: "secao", texto: "Colunas a preencher" },
    { campo: "Pontos a Adicionar", desc: "Quantidade de pontos a lançar. Apenas números." },
    { campo: "KM Percorridos",     desc: "Quilômetros percorridos. Apenas números. Use 0 se não aplicável." },
    { campo: "Descrição / Evento", desc: "Nome do evento, treino ou descrição do lançamento." },
    { campo: "Data",               desc: "Data do lançamento no formato DD/MM/AAAA." },
  ]);

  await downloadWorkbook(wb, nomeArquivo(`Modelo_Lancamentos_${mod}`));
}

export async function exportarFinanceiroXlsx(historicoFinanceiro) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Atletas Energisa";
  const ws = wb.addWorksheet("Financeiro");
  ws.views = [{ showGridLines: false }];

  ws.columns = [
    { width: 18 }, { width: 22 }, { width: 36 }, { width: 14 },
    { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
    { width: 16 }, { width: 18 }, { width: 18 }, { width: 16 },
  ];

  const hRow = ws.addRow([
    "Equipe", "Categoria", "Evento / Custo", "Tipo",
    "Inscrições", "Transporte", "Hospedagem", "Alimentação",
    "Demais Custos", "Total Proposto", "Total Realizado", "Desvio"
  ]);
  hRow.height = 22;
  hRow.eachCell(cell => aplicarHeader(cell, cell.value));

  const totais = new Array(8).fill(0);
  historicoFinanceiro.forEach((v, i) => {
    const alt  = i % 2 === 1;
    const tipo = v.avulso ? "Avulso" : "Planejado";
    const vals = [
      Number(v.propInsc   || 0), Number(v.propTransp || 0),
      Number(v.propHosp   || 0), Number(v.propAlim   || 0),
      Number(v.propDemais || 0),
      Number(v.totalProposto  || v.orcadoTotal  || 0),
      Number(v.totalRealizado || 0),
      Number(v.desvio !== undefined ? v.desvio : ((v.totalProposto || v.orcadoTotal || 0) - (v.totalRealizado || 0))),
    ];
    vals.forEach((val, j) => (totais[j] += val));

    const row = ws.addRow([v.equipe || "Ambas", v.categoria || "-", v.evento || v.descricao || "-", tipo, ...vals]);
    row.height = 18;
    aplicarNormal(row.getCell(1), v.equipe    || "Ambas", alt);
    aplicarNormal(row.getCell(2), v.categoria || "-",     alt);
    aplicarNormal(row.getCell(3), v.evento    || v.descricao || "-", alt);
    aplicarNormal(row.getCell(4), tipo, alt);
    vals.forEach((val, j) => aplicarMoeda(row.getCell(5 + j), val, alt));
  });

  const tRow = ws.addRow(["TOTAL", "", "", "", ...totais]);
  tRow.height = 22;
  [1,2,3,4].forEach(c => aplicarTotal(tRow.getCell(c), c === 1 ? "TOTAL" : ""));
  totais.forEach((val, j) => aplicarTotal(tRow.getCell(5 + j), val, true));

  ws.autoFilter = { from: "A1", to: "L1" };

  adicionarAbaInstrucoes(wb, "Instruções — Controle Orçamentário", [
    { tipo: "secao", texto: "Descrição das colunas" },
    { campo: "Equipe",          desc: "Equipe vinculada ao gasto: Bicicleta, Corrida ou Ambas." },
    { campo: "Categoria",       desc: "Categoria do evento ou despesa." },
    { campo: "Evento / Custo",  desc: "Nome do evento ou descrição da despesa." },
    { campo: "Tipo",            desc: "Planejado (dentro do orçamento) ou Avulso (extra)." },
    { campo: "Inscrições",      desc: "Valor de inscrição dos atletas." },
    { campo: "Transporte",      desc: "Custo de transporte." },
    { campo: "Hospedagem",      desc: "Custo de hospedagem." },
    { campo: "Alimentação",     desc: "Custo de alimentação." },
    { campo: "Demais Custos",   desc: "Outros custos não categorizados." },
    { campo: "Total Proposto",  desc: "Soma do orçamento aprovado para o item." },
    { campo: "Total Realizado", desc: "Valor efetivamente gasto." },
    { campo: "Desvio",          desc: "Diferença entre proposto e realizado (positivo = sobrou)." },
  ]);

  await downloadWorkbook(wb, nomeArquivo("Controle_Orcamentario_Atletas"));
}
