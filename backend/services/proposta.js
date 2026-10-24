// PB17 — proposta consolidada: junta residência, consumo, recurso solar, dimensionamento,
// equipamentos, geração, baterias, orçamento, economia (PB15) e payback simples (PB16).
// Funções puras. O orçamento é calculado aqui (Custo_item = quantidade × preço unitário;
// Custo_total = soma dos itens), a partir dos preços recebidos dos datasets.

const { calcularEconomia } = require('./economia');
const { calcularPayback } = require('./payback');

const DIAS_MES = 30;

function arredondar(valor, casas = 2) {
  return Number(valor.toFixed(casas));
}

function numeroValido(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function texto(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

function inteiroPositivo(valor) {
  return Number.isInteger(valor) && valor > 0;
}

function validarEntrada(e) {
  const erros = [];
  if (!e || typeof e !== 'object') return ['dados da proposta não informados'];

  const r = e.residencia;
  if (!r || !texto(r.endereco) || !texto(r.cidade) || !texto(r.uf)) {
    erros.push('residência exige endereço, cidade e UF');
  }
  if (!e.consumo || !numeroValido(e.consumo.mensalKwh) || e.consumo.mensalKwh <= 0) {
    erros.push('consumo mensal deve ser um número maior que zero (kWh/mês)');
  }
  const s = e.recursoSolar;
  if (!s || !numeroValido(s.hsp) || s.hsp <= 0) erros.push('HSP deve ser maior que zero');
  if (!s || !texto(s.hspFonte)) erros.push('informe a fonte da HSP');
  if (!s || !numeroValido(s.pr) || s.pr <= 0 || s.pr > 1) erros.push('PR deve estar entre 0 (exclusivo) e 1');
  if (!s || !texto(s.prJustificativa)) erros.push('justifique o PR adotado');

  for (const [campo, rotulo] of [['potenciaFvNecessariaKwp', 'potência FV necessária'], ['potenciaInstaladaKwp', 'potência FV instalada']]) {
    if (!numeroValido(e[campo]) || e[campo] <= 0) erros.push(`${rotulo} deve ser maior que zero (kWp)`);
  }
  const m = e.modulos;
  if (!m || !texto(m.fabricante) || !texto(m.modelo) || !inteiroPositivo(m.quantidade) || !numeroValido(m.potenciaWp) || m.potenciaWp <= 0) {
    erros.push('módulos exigem fabricante, modelo, quantidade inteira positiva e potência (Wp)');
  }
  const i = e.inversor;
  if (!i || !texto(i.fabricante) || !texto(i.modelo) || !numeroValido(i.potenciaKw) || i.potenciaKw <= 0) {
    erros.push('inversor exige fabricante, modelo e potência nominal (kW)');
  }
  if (!numeroValido(e.geracaoMensalKwh) || e.geracaoMensalKwh < 0) erros.push('geração mensal deve ser não negativa (kWh/mês)');
  if (!numeroValido(e.atendimentoPercent) || e.atendimentoPercent < 0) erros.push('atendimento deve ser não negativo (%)');

  if (e.bateria) {
    const b = e.bateria;
    if (!texto(b.fabricante) || !texto(b.modelo) || !inteiroPositivo(b.quantidade) || !numeroValido(b.capacidadeTotalKwh) || b.capacidadeTotalKwh <= 0) {
      erros.push('baterias exigem fabricante, modelo, quantidade inteira positiva e capacidade total (kWh)');
    }
    if (!numeroValido(e.autonomiaHoras) || e.autonomiaHoras <= 0) erros.push('autonomia deve ser maior que zero (h)');
  }

  const itens = e.orcamento && e.orcamento.itens;
  if (!Array.isArray(itens) || itens.length === 0) {
    erros.push('orçamento exige ao menos um item');
  } else {
    itens.forEach((it, n) => {
      if (!it || !texto(it.equipamento) || !texto(it.fabricanteModelo) || !inteiroPositivo(it.quantidade) || !numeroValido(it.precoUnitario) || it.precoUnitario < 0) {
        erros.push(`item ${n + 1} do orçamento: informe equipamento, fabricante/modelo, quantidade inteira positiva e preço unitário não negativo`);
      }
    });
  }
  return erros;
}

function montarOrcamento(itens) {
  const linhas = itens.map((it) => ({
    equipamento: it.equipamento,
    fabricanteModelo: it.fabricanteModelo,
    quantidade: it.quantidade,
    precoUnitario: arredondar(it.precoUnitario),
    subtotal: arredondar(it.quantidade * it.precoUnitario)
  }));
  const total = arredondar(linhas.reduce((soma, l) => soma + l.subtotal, 0));
  return { itens: linhas, total };
}

function montarProposta(entrada) {
  const erros = validarEntrada(entrada);
  if (erros.length > 0) return { erros };

  const orcamento = montarOrcamento(entrada.orcamento.itens);

  const economia = calcularEconomia({
    tarifaReaisKwh: entrada.tarifa && entrada.tarifa.valorReaisKwh,
    tarifaFonte: entrada.tarifa && entrada.tarifa.fonte,
    energiaGeradaKwhMes: entrada.geracaoMensalKwh,
    consumoKwhMes: entrada.consumo.mensalKwh,
    energiaCompensadaKwhMes: entrada.energiaCompensadaKwhMes
  });
  if (economia.erros) return { erros: economia.erros };

  const payback = calcularPayback({ investimentoTotal: orcamento.total, economiaAnual: economia.economiaAnual });
  if (payback.erros) return { erros: payback.erros };

  const comBaterias = Boolean(entrada.bateria);
  const avisos = [...payback.avisos];
  if (entrada.potenciaInstaladaKwp < entrada.potenciaFvNecessariaKwp) {
    avisos.push('a potência instalada é menor que a necessária');
  }

  return {
    residencia: entrada.residencia,
    consumo: {
      mensalKwh: arredondar(entrada.consumo.mensalKwh),
      diarioKwh: arredondar(entrada.consumo.mensalKwh / DIAS_MES),
      potenciaInstaladaKw: numeroValido(entrada.consumo.potenciaInstaladaKw) ? entrada.consumo.potenciaInstaladaKw : null
    },
    recursoSolar: entrada.recursoSolar,
    dimensionamento: {
      potenciaNecessariaKwp: arredondar(entrada.potenciaFvNecessariaKwp),
      potenciaInstaladaKwp: arredondar(entrada.potenciaInstaladaKwp),
      modulos: entrada.modulos,
      inversor: entrada.inversor
    },
    geracao: {
      mensalKwh: arredondar(entrada.geracaoMensalKwh),
      diariaKwh: arredondar(entrada.geracaoMensalKwh / DIAS_MES),
      atendimentoPercent: arredondar(entrada.atendimentoPercent)
    },
    armazenamento: comBaterias
      ? { tipo: 'com baterias', bateria: entrada.bateria, autonomiaHoras: entrada.autonomiaHoras }
      : { tipo: 'sem baterias', bateria: null, autonomiaHoras: null },
    orcamento,
    economia,
    payback,
    avisos
  };
}

function esc(valor) {
  return String(valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function brl(valor) {
  return 'R$ ' + valor.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function num(valor, unidade) {
  return `${String(valor).replace('.', ',')} ${unidade}`;
}

// Texto corrido gerado pelos serviços usa ponto decimal; no relatório em pt-BR usa vírgula.
function virgula(textoLivre) {
  return String(textoLivre).replace(/(\d)\.(\d)/g, '$1,$2');
}

function tabela(linhas) {
  return '<table>' + linhas.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('') + '</table>';
}

// Relatório HTML simples e autocontido (toda entrada do usuário é escapada).
function renderizarHtml(p) {
  const r = p.residencia;
  const d = p.dimensionamento;
  const s = p.recursoSolar;
  const a = p.armazenamento;
  const itens = p.orcamento.itens.map((i) =>
    `<tr><td>${esc(i.equipamento)}</td><td>${esc(i.fabricanteModelo)}</td><td>${i.quantidade}</td><td class="n">${esc(brl(i.precoUnitario))}</td><td class="n">${esc(brl(i.subtotal))}</td></tr>`).join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Proposta de sistema fotovoltaico</title>
<style>body{font-family:Arial,sans-serif;max-width:820px;margin:24px auto;color:#1a1a1a}h1{font-size:22px}h2{font-size:16px;margin-top:22px;border-bottom:1px solid #ccc}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:14px}th{background:#f3f3f3;width:40%}td.n{white-space:nowrap}.aviso{background:#fff4d6;padding:8px;margin:6px 0}</style></head><body>
<h1>Proposta de sistema fotovoltaico</h1>
<h2>Residência</h2>${tabela([['Endereço', r.endereco], ['Cidade/UF', `${r.cidade}/${r.uf}`]])}
<h2>Consumo</h2>${tabela([['Consumo mensal', num(p.consumo.mensalKwh, 'kWh/mês')], ['Consumo diário médio', num(p.consumo.diarioKwh, 'kWh/dia')], ['Potência instalada da residência', p.consumo.potenciaInstaladaKw === null ? 'não informada' : num(p.consumo.potenciaInstaladaKw, 'kW')]])}
<h2>Recurso solar</h2>${tabela([['HSP', num(s.hsp, 'h/dia')], ['Fonte da HSP', s.hspFonte], ['PR (desempenho global)', String(s.pr).replace('.', ',')], ['Justificativa do PR', s.prJustificativa]])}
<h2>Dimensionamento</h2>${tabela([['Potência FV necessária', num(d.potenciaNecessariaKwp, 'kWp')], ['Potência FV instalada', num(d.potenciaInstaladaKwp, 'kWp')], ['Módulos', `${d.modulos.quantidade} × ${d.modulos.fabricante} ${d.modulos.modelo} (${d.modulos.potenciaWp} Wp)`], ['Inversor', `${d.inversor.fabricante} ${d.inversor.modelo} (${d.inversor.potenciaKw} kW)`]])}
<h2>Geração e atendimento</h2>${tabela([['Geração mensal estimada', num(p.geracao.mensalKwh, 'kWh/mês')], ['Geração diária estimada', num(p.geracao.diariaKwh, 'kWh/dia')], ['Atendimento do consumo', num(p.geracao.atendimentoPercent, '%')]])}
<h2>Armazenamento</h2>${a.bateria
    ? tabela([['Alternativa', 'Com baterias'], ['Baterias', `${a.bateria.quantidade} × ${a.bateria.fabricante} ${a.bateria.modelo}`], ['Capacidade instalada', num(a.bateria.capacidadeTotalKwh, 'kWh')], ['Autonomia', num(a.autonomiaHoras, 'h')]])
    : tabela([['Alternativa', 'Sem baterias']])}
<h2>Orçamento</h2><table><tr><th>Equipamento</th><th>Fabricante/modelo</th><th>Qtd.</th><th>Preço unitário</th><th>Subtotal</th></tr>${itens}<tr><th colspan="4">Total</th><th class="n" style="white-space:nowrap">${esc(brl(p.orcamento.total))}</th></tr></table>
<h2>Economia estimada</h2>${tabela([['Tarifa', `${brl(p.economia.tarifa.valorReaisKwh)}/kWh (fonte: ${p.economia.tarifa.fonte})`], ['Energia compensada', num(p.economia.energiaCompensadaKwhMes, 'kWh/mês')], ['Economia mensal', brl(p.economia.economiaMensal)], ['Economia anual', brl(p.economia.economiaAnual)]])}
<h2>Payback simples</h2><p>${esc(virgula(p.payback.descricao))}</p>
<h2>Premissas</h2><ul>${[...p.economia.premissas, ...p.payback.premissas].map((x) => `<li>${esc(virgula(x))}</li>`).join('')}</ul>
${p.avisos.map((x) => `<div class="aviso">${esc(x)}</div>`).join('')}
</body></html>`;
}

module.exports = { validarEntrada, montarOrcamento, montarProposta, renderizarHtml };
