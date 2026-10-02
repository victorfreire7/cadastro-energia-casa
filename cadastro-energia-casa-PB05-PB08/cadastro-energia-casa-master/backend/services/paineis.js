const fs = require('fs');
const path = require('path');
const { converterNumero } = require('./dimensionamento');

// PB06 — dataset de módulos fotovoltaicos (nenhum módulo fica fixo no código)
const ARQUIVO_PADRAO = path.join(__dirname, '..', 'data', 'paineis.csv');
const COLUNAS = ['id', 'fabricante', 'modelo', 'potencia_wp', 'eficiencia_pct', 'preco_brl', 'fonte'];

// Faixas plausíveis para módulos residenciais/comerciais atuais
const POTENCIA_WP_MIN = 100;
const POTENCIA_WP_MAX = 800;
const EFICIENCIA_MIN = 10;
const EFICIENCIA_MAX = 28;

// Divide uma linha CSV respeitando campos entre aspas (a coluna "fonte" pode ter vírgulas)
function dividirLinhaCsv(linha) {
  const campos = [];
  let atual = '';
  let entreAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (entreAspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        entreAspas = !entreAspas;
      }
    } else if (c === ',' && !entreAspas) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

// Valida uma linha já separada em campos; devolve { painel } ou { erro }
function validarPainel(campos) {
  if (campos.length !== COLUNAS.length) {
    return { erro: `esperado ${COLUNAS.length} colunas, encontrado ${campos.length}` };
  }
  const [idTexto, fabricante, modelo, potenciaTexto, eficienciaTexto, precoTexto, fonte] = campos;

  const id = converterNumero(idTexto);
  if (!Number.isInteger(id) || id <= 0) return { erro: 'id deve ser inteiro positivo' };
  if (!fabricante) return { erro: 'fabricante é obrigatório' };
  if (!modelo) return { erro: 'modelo é obrigatório' };
  if (!fonte) return { erro: 'fonte é obrigatória (origem documentada dos dados)' };

  const potenciaWp = converterNumero(potenciaTexto);
  if (Number.isNaN(potenciaWp) || potenciaWp < POTENCIA_WP_MIN || potenciaWp > POTENCIA_WP_MAX) {
    return { erro: `potencia_wp deve ser numérica entre ${POTENCIA_WP_MIN} e ${POTENCIA_WP_MAX}` };
  }

  const eficienciaPct = converterNumero(eficienciaTexto);
  if (Number.isNaN(eficienciaPct) || eficienciaPct < EFICIENCIA_MIN || eficienciaPct > EFICIENCIA_MAX) {
    return { erro: `eficiencia_pct deve ser numérica entre ${EFICIENCIA_MIN} e ${EFICIENCIA_MAX}` };
  }

  const precoBrl = converterNumero(precoTexto);
  if (Number.isNaN(precoBrl) || precoBrl <= 0) {
    return { erro: 'preco_brl deve ser numérico e maior que zero' };
  }

  return { painel: { id, fabricante, modelo, potenciaWp, eficienciaPct, precoBrl, fonte } };
}

// Carrega e valida o dataset inteiro; qualquer problema interrompe com mensagem clara
function carregarPaineis(arquivo = ARQUIVO_PADRAO) {
  const linhas = fs.readFileSync(arquivo, 'utf-8').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (linhas.length === 0) {
    throw new Error('dataset de painéis vazio');
  }

  const cabecalho = dividirLinhaCsv(linhas.shift());
  if (COLUNAS.some((c, i) => cabecalho[i] !== c) || cabecalho.length !== COLUNAS.length) {
    throw new Error(`dataset de painéis com cabeçalho inválido (esperado: ${COLUNAS.join(',')})`);
  }
  if (linhas.length === 0) {
    throw new Error('dataset de painéis sem nenhum módulo');
  }

  const paineis = new Map();
  linhas.forEach((linha, indice) => {
    const resultado = validarPainel(dividirLinhaCsv(linha));
    if (resultado.erro) {
      throw new Error(`dataset de painéis, linha ${indice + 2}: ${resultado.erro}`);
    }
    const { painel } = resultado;
    if (paineis.has(painel.id)) {
      throw new Error(`dataset de painéis com id duplicado: ${painel.id}`);
    }
    paineis.set(painel.id, painel);
  });

  return paineis;
}

let cache = null;
function tabelaPaineis() {
  if (!cache) cache = carregarPaineis();
  return cache;
}

function listarPaineis(tabela = tabelaPaineis()) {
  return [...tabela.values()];
}

function obterPainelPorId(id, tabela = tabelaPaineis()) {
  return tabela.get(Number(id)) || null;
}

module.exports = {
  COLUNAS,
  POTENCIA_WP_MIN,
  POTENCIA_WP_MAX,
  EFICIENCIA_MIN,
  EFICIENCIA_MAX,
  dividirLinhaCsv,
  validarPainel,
  carregarPaineis,
  tabelaPaineis,
  listarPaineis,
  obterPainelPorId
};
