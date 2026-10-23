const fs = require('fs');
const path = require('path');
const { converterNumero, arredondar } = require('./dimensionamento');

const ARQUIVO_PADRAO = path.join(__dirname, '..', 'data', 'baterias.csv');
const COLUNAS = [
  'id',
  'fabricante',
  'modelo',
  'tecnologia',
  'tensao_v',
  'capacidade_ah',
  'capacidade_kwh',
  'dod_pct',
  'ciclos',
  'preco_brl',
  'data_consulta_tecnica',
  'data_consulta_preco',
  'fonte'
];

function dataValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

function lerCiclos(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return { ciclos: null, ciclosCondicao: null, ciclosTexto: null };
  const correspondencia = texto.match(/^(>=|>|<=|<|=)?\s*(\d+)$/);
  if (!correspondencia) return null;
  const ciclos = Number(correspondencia[2]);
  if (!Number.isSafeInteger(ciclos) || ciclos <= 0) return null;
  const condicao = correspondencia[1] || '=';
  return {
    ciclos,
    ciclosCondicao: condicao,
    ciclosTexto: condicao === '=' ? String(ciclos) : `${condicao}${ciclos}`
  };
}

function lerLinha(linha) {
  const [idTexto, fabricante, modelo, tecnologia, tensaoTexto, capacidadeAhTexto, capacidadeTexto, dodTexto, ciclosTexto, precoTexto, dataConsultaTecnica, dataConsultaPreco, ...resto] =
    linha.split(',').map((c) => c.trim());
  const id = converterNumero(idTexto);
  const capacidadeKwh = converterNumero(capacidadeTexto);
  const capacidadeAh = converterNumero(capacidadeAhTexto);
  const dodPercentual = converterNumero(dodTexto);
  const tensaoV = converterNumero(tensaoTexto);
  const precoBrl = converterNumero(precoTexto);
  const ciclos = lerCiclos(ciclosTexto);
  const fonte = resto.join(',').trim();

  const valido =
    Number.isInteger(id) && id > 0 &&
    fabricante && modelo && tecnologia && fonte && ciclos &&
    Number.isFinite(capacidadeKwh) && capacidadeKwh > 0 &&
    Number.isFinite(capacidadeAh) && capacidadeAh > 0 &&
    Number.isFinite(dodPercentual) && dodPercentual > 0 && dodPercentual <= 100 &&
    Number.isFinite(tensaoV) && tensaoV > 0 &&
    Number.isFinite(precoBrl) && precoBrl > 0 &&
    dataValida(dataConsultaTecnica) &&
    dataValida(dataConsultaPreco);

  if (!valido) return null;
  return {
    id,
    fabricante,
    modelo,
    tecnologia,
    capacidadeAh,
    capacidadeKwh,
    dod: dodPercentual / 100,
    dodPercentual,
    tensaoV,
    ...ciclos,
    precoBrl,
    dataConsulta: dataConsultaPreco,
    dataConsultaPreco,
    dataConsultaTecnica,
    fonte
  };
}

function carregarBaterias(arquivo = ARQUIVO_PADRAO) {
  const linhas = fs.readFileSync(arquivo, 'utf-8').split(/\r?\n/).filter((l) => l.trim() !== '');
  const cabecalho = linhas.shift()?.split(',').map((c) => c.trim()) || [];
  if (cabecalho.length !== COLUNAS.length || COLUNAS.some((c, i) => cabecalho[i] !== c)) {
    throw new Error(`dataset de baterias com cabeçalho inválido (esperado: ${COLUNAS.join(',')})`);
  }

  const baterias = [];
  for (const linha of linhas) {
    const bateria = lerLinha(linha);
    if (!bateria) throw new Error(`dataset de baterias com linha inválida: "${linha}"`);
    if (baterias.some((b) => b.id === bateria.id)) {
      throw new Error(`dataset de baterias com id duplicado: ${bateria.id}`);
    }
    baterias.push(bateria);
  }
  if (baterias.length === 0) throw new Error('dataset de baterias vazio');
  return baterias;
}

let cache = null;
function bateriasDisponiveis() {
  if (!cache) cache = carregarBaterias();
  return cache;
}

function selecionarBateria(bateriaId, baterias = bateriasDisponiveis()) {
  const id = converterNumero(bateriaId);
  if (!Number.isInteger(id) || id <= 0) return { erro: 'bateriaId deve ser um identificador válido' };
  const bateria = baterias.find((b) => b.id === id);
  if (!bateria) return { erro: 'bateria selecionada não encontrada' };
  return { bateria };
}

// PB11 — dimensiona pela fórmula nominal C_bat = E_autonomia / (DoD × eficiência).
function dimensionarBaterias({ bateria, energiaAutonomiaKwh, eficiencia }) {
  if (!bateria) return { erro: 'bateria selecionada é obrigatória' };
  if (!Number.isFinite(energiaAutonomiaKwh) || energiaAutonomiaKwh <= 0) {
    return { erro: 'energiaAutonomiaKwh deve ser maior que zero' };
  }
  if (!Number.isFinite(eficiencia) || eficiencia <= 0 || eficiencia > 1) {
    return { erro: 'eficiencia deve estar entre 0 e 1' };
  }
  if (!Number.isFinite(bateria.dod) || bateria.dod <= 0 || bateria.dod > 1) {
    return { erro: 'DoD da bateria deve estar entre 0 e 1' };
  }
  if (!Number.isFinite(bateria.capacidadeKwh) || bateria.capacidadeKwh <= 0) {
    return { erro: 'capacidade nominal da bateria deve ser maior que zero' };
  }

  const energiaUtilNecessariaKwh = energiaAutonomiaKwh / eficiencia;
  const capacidadeNominalNecessariaKwh = energiaAutonomiaKwh / (bateria.dod * eficiencia);
  const capacidadeUtilUnitariaKwh = bateria.capacidadeKwh * bateria.dod;
  const quantidade = Math.ceil(capacidadeNominalNecessariaKwh / bateria.capacidadeKwh);
  const capacidadeInstaladaKwh = quantidade * bateria.capacidadeKwh;
  const custoBrl = quantidade * bateria.precoBrl;
  return {
    bateria,
    quantidade,
    energiaUtilNecessariaKwh: arredondar(energiaUtilNecessariaKwh),
    capacidadeNominalNecessariaKwh: arredondar(capacidadeNominalNecessariaKwh),
    capacidadeUtilUnitariaKwh: arredondar(capacidadeUtilUnitariaKwh),
    capacidadeInstaladaKwh: arredondar(capacidadeInstaladaKwh),
    capacidadeUtilInstaladaKwh: arredondar(quantidade * capacidadeUtilUnitariaKwh),
    custoBrl: arredondar(custoBrl)
  };
}

function montarLogSelecaoBateria(resultado, energiaAutonomiaKwh, eficiencia) {
  return {
    etapa: 'SELECAO_BATERIA',
    formula: 'N_bat = teto(C_bat / C_unidade); C_bat = E_autonomia / (DoD × η_bat)',
    entradas: {
      bateria_id: resultado.bateria.id,
      fabricante: resultado.bateria.fabricante,
      modelo: resultado.bateria.modelo,
      capacidade_nominal_unidade_kwh: resultado.bateria.capacidadeKwh,
      DoD: resultado.bateria.dod,
      E_autonomia_kwh: energiaAutonomiaKwh,
      eficiencia_bateria: eficiencia,
      capacidade_nominal_necessaria_kwh: resultado.capacidadeNominalNecessariaKwh
    },
    resultado: resultado.quantidade,
    unidade: 'baterias'
  };
}

module.exports = {
  COLUNAS,
  carregarBaterias,
  bateriasDisponiveis,
  selecionarBateria,
  dimensionarBaterias,
  montarLogSelecaoBateria
};
