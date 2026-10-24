import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';

// Sprint 3 (PB18–PB21): fluxo completo na interface —
// residência → consumo → recurso solar → dimensionamento → inversor → baterias (opcional)
// → orçamento → economia/payback → proposta → salvar/recuperar/exportar.

const brl = (v) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const num = (v, casas = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas }));

const PR_JUSTIFICATIVA_PADRAO =
  'Valor de referência para sistemas residenciais: considera perdas por temperatura, cabeamento, sujeira, conversão no inversor e descasamento (≈ 75%).';

const FORM_INICIAL = {
  consumoKwhMes: '', percentualAtendimento: '100',
  hsp: '', hspFonte: '', pr: '0.75', prJustificativa: PR_JUSTIFICATIVA_PADRAO,
  painelId: '', inversorId: '',
  comBaterias: false, bateriaId: '', autonomiaHoras: '6', inversorComBateriasId: '',
  tarifaReaisKwh: '', tarifaFonte: '',
  custoComplementarBrl: '', custoComplementarDescricao: '',
  titulo: ''
};

function mensagemDeErro(err) {
  const d = err.response && err.response.data;
  if (d && Array.isArray(d.erros) && d.erros.length > 1) return d.erros;
  if (d && d.message) return [d.message];
  return ['Não foi possível falar com o servidor. Tente novamente.'];
}

function Linha({ k, v }) {
  return (
    <tr>
      <th>{k}</th>
      <td>{v}</td>
    </tr>
  );
}

function Orcamento({ proposta }) {
  return (
    <table className="table">
      <thead>
        <tr><th>Equipamento</th><th>Fabricante/modelo</th><th>Qtd.</th><th>Preço unit.</th><th>Subtotal</th></tr>
      </thead>
      <tbody>
        {proposta.orcamento.itens.map((i, n) => (
          <tr key={n}>
            <td>{i.equipamento}</td><td>{i.fabricanteModelo}</td><td>{i.quantidade}</td>
            <td>{brl(i.precoUnitario)}</td><td>{brl(i.subtotal)}</td>
          </tr>
        ))}
        <tr><th colSpan="4">Total</th><th>{brl(proposta.orcamento.total)}</th></tr>
      </tbody>
    </table>
  );
}

// Leitura dos números do próprio sistema (não é opinião genérica): usa o que foi calculado.
function leituraComparacao(r) {
  if (!r.comparacao) return null;
  const sem = r.semBaterias;
  const com = r.comBaterias;
  const res = r.comparacao.resumo;
  const partes = [
    `O sistema sem baterias custa ${brl(sem.orcamento.total)} e tem ${sem.payback.paybackAnos === null ? 'payback indefinido' : `payback simples de ${num(sem.payback.paybackAnos)} anos`}.`,
    `Com baterias (${r.armazenamento.quantidade} un., ${num(r.armazenamento.capacidadeInstaladaKwh)} kWh, autonomia de ${num(r.armazenamento.autonomiaHoras, 0)} h) o investimento sobe ${brl(res.investimentoAdicional)} para ${brl(com.orcamento.total)}, com ${com.payback.paybackAnos === null ? 'payback indefinido' : `payback simples de ${num(com.payback.paybackAnos)} anos`}.`
  ];
  if (res.ganhoAtendimentoPontosPercentuais <= 0) {
    partes.push('As baterias não aumentam a geração nem o percentual de atendimento neste modelo (a economia calculada é a mesma); o ganho delas é a autonomia em falta de energia.');
  }
  return partes.join(' ');
}

export default function Projeto() {
  const { imovelId } = useParams();
  const navigate = useNavigate();

  const [imoveis, setImoveis] = useState([]);
  const [ctx, setCtx] = useState(null);
  const [form, setForm] = useState(FORM_INICIAL);
  const [pre, setPre] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [salvos, setSalvos] = useState([]);
  const [projetoSalvoId, setProjetoSalvoId] = useState(null);
  const [erros, setErros] = useState([]);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Só estes campos mudam potência/módulos/inversores; os demais apenas invalidam a proposta calculada.
  const CAMPOS_DO_DIMENSIONAMENTO = ['consumoKwhMes', 'percentualAtendimento', 'hsp', 'pr', 'painelId'];
  const set = (campo, valor) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    if (CAMPOS_DO_DIMENSIONAMENTO.includes(campo)) setPre(null);
    setResultado(null);
    setProjetoSalvoId(null);
    setAviso('');
  };

  useEffect(() => {
    api.get('/imoveis').then(({ data }) => setImoveis(data)).catch((e) => setErros(mensagemDeErro(e)));
  }, []);

  // PB01/PB02: ao escolher a residência, traz consumo, localidade, HSP e datasets sozinho
  useEffect(() => {
    setCtx(null); setPre(null); setResultado(null); setSalvos([]); setProjetoSalvoId(null); setErros([]);
    if (!imovelId) return;
    api.get(`/imoveis/${imovelId}/projetos/contexto`)
      .then(({ data }) => {
        setCtx(data);
        setForm({
          ...FORM_INICIAL,
          hsp: data.hsp ? String(data.hsp.valor) : '',
          hspFonte: data.hsp ? data.hsp.fonte : '',
          pr: String(data.prSugerido)
        });
      })
      .catch((e) => setErros(mensagemDeErro(e)));
    carregarSalvos();
  }, [imovelId]);

  function carregarSalvos() {
    if (!imovelId) return;
    api.get(`/imoveis/${imovelId}/projetos`).then(({ data }) => setSalvos(data)).catch(() => {});
  }

  const corpo = () => ({
    ...form,
    comBaterias: form.comBaterias,
    inversorComBateriasId: form.inversorComBateriasId || form.inversorId
  });

  async function dimensionar() {
    setErros([]); setOcupado(true);
    try {
      const { data } = await api.post(`/imoveis/${imovelId}/projetos/pre-dimensionamento`, corpo());
      setPre(data);
      setResultado(null);
    } catch (e) {
      setPre(null);
      setErros(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function calcular() {
    setErros([]); setOcupado(true);
    try {
      const { data } = await api.post(`/imoveis/${imovelId}/projetos/calcular`, corpo());
      setResultado(data);
    } catch (e) {
      setResultado(null);
      setErros(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function salvar() {
    setErros([]); setOcupado(true);
    try {
      const { data } = await api.post(`/imoveis/${imovelId}/projetos`, corpo());
      setResultado(data.resultado);
      setProjetoSalvoId(data.id);
      setAviso(`Projeto "${data.titulo}" salvo.`);
      carregarSalvos();
    } catch (e) {
      setErros(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function abrirSalvo(id) {
    setErros([]); setOcupado(true);
    try {
      const { data } = await api.get(`/imoveis/${imovelId}/projetos/${id}`);
      setForm({ ...FORM_INICIAL, ...Object.fromEntries(Object.entries(data.entrada).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v])), comBaterias: Boolean(data.entrada.comBaterias), titulo: data.titulo });
      setResultado(data.resultado);
      setProjetoSalvoId(data.id);
      setPre(null);
      setAviso(`Projeto "${data.titulo}" recuperado.`);
    } catch (e) {
      setErros(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function excluirSalvo(id) {
    if (!window.confirm('Excluir este projeto salvo?')) return;
    try {
      await api.delete(`/imoveis/${imovelId}/projetos/${id}`);
      if (projetoSalvoId === id) setProjetoSalvoId(null);
      carregarSalvos();
    } catch (e) {
      setErros(mensagemDeErro(e));
    }
  }

  // PB21: abre a proposta (HTML) pronta para apresentar/imprimir (o token vai no cabeçalho)
  async function exportarProposta(id) {
    try {
      const { data } = await api.get(`/imoveis/${imovelId}/projetos/${id}/proposta`, { params: { formato: 'html' }, responseType: 'text' });
      const url = URL.createObjectURL(new Blob([data], { type: 'text/html;charset=utf-8' }));
      window.open(url, '_blank');
    } catch (e) {
      setErros(mensagemDeErro(e));
    }
  }

  async function baixarProposta(id) {
    try {
      const { data } = await api.get(`/imoveis/${imovelId}/projetos/${id}/proposta`, { params: { formato: 'html' }, responseType: 'text' });
      const url = URL.createObjectURL(new Blob([data], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = `proposta-${id}.html`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErros(mensagemDeErro(e));
    }
  }

  const baterias = ctx ? ctx.baterias : [];
  const bateriaEscolhida = baterias.find((b) => String(b.id) === String(form.bateriaId));
  const inversoresCompativeis = pre ? pre.inversores.filter((i) => i.compativel) : [];
  const hibridos = useMemo(() => inversoresCompativeis.filter((i) =>
    i.suportaBateria && (!bateriaEscolhida || i.bateriasCompativeis.length === 0 ||
      i.bateriasCompativeis.includes(`${bateriaEscolhida.fabricante} ${bateriaEscolhida.modelo}`))), [pre, form.bateriaId]);

  const r = resultado;
  const p = r && r.proposta;

  return (
    <div className="dashboard">
      <Link to="/dashboard" className="back-link">← Voltar</Link>
      <h1>Projeto fotovoltaico completo</h1>
      <p className="imovel-meta">
        Fluxo: residência → consumo → recurso solar → dimensionamento → inversor → baterias → orçamento → economia → proposta.
      </p>

      {erros.length > 0 && (
        <div className="error-message" role="alert">
          {erros.length === 1 ? erros[0] : (<ul>{erros.map((m, n) => <li key={n}>{m}</li>)}</ul>)}
        </div>
      )}
      {aviso && <div className="aviso-ok">{aviso}</div>}

      <h2 className="section-title">1. Residência</h2>
      <div className="field">
        <label htmlFor="imovel">Escolha uma residência já cadastrada</label>
        <select id="imovel" value={imovelId || ''} onChange={(e) => navigate(e.target.value ? `/projeto/${e.target.value}` : '/projeto')}>
          <option value="">Selecione…</option>
          {imoveis.map((i) => <option key={i.id} value={i.id}>{i.endereco}{i.cidade ? ` — ${i.cidade}/${i.uf}` : ''}</option>)}
        </select>
      </div>

      {salvos.length > 0 && (
        <>
          <h3 className="section-title">Projetos salvos desta residência</h3>
          <table className="table">
            <thead><tr><th>Projeto</th><th>Alternativa</th><th>Investimento</th><th>Economia/ano</th><th>Data</th><th></th></tr></thead>
            <tbody>
              {salvos.map((s) => (
                <tr key={s.id}>
                  <td>{s.titulo}</td><td>{s.alternativa === 'com' ? 'com baterias' : 'sem baterias'}</td>
                  <td>{brl(s.investimentoTotalBrl)}</td><td>{brl(s.economiaAnualBrl)}</td>
                  <td>{new Date(s.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td>
                    <button className="btn-secondary" onClick={() => abrirSalvo(s.id)}>Abrir</button>{' '}
                    <button className="btn-secondary" onClick={() => exportarProposta(s.id)}>Proposta</button>{' '}
                    <button className="btn-remove" onClick={() => excluirSalvo(s.id)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {ctx && (
        <>
          <table className="table resultado-cenario">
            <tbody>
              <Linha k="Endereço" v={`${ctx.residencia.endereco} — ${ctx.residencia.cidade || '?'}/${ctx.residencia.uf || '?'}`} />
              <Linha k="Consumo mensal" v={ctx.consumo.mensalKwh ? `${num(ctx.consumo.mensalKwh)} kWh/mês (${ctx.consumo.origem === 'historico' ? 'média do histórico' : 'estimado pelos eletrodomésticos'})` : 'sem consumo calculado — informe abaixo'} />
              <Linha k="Consumo diário médio" v={ctx.consumo.diarioKwh ? `${num(ctx.consumo.diarioKwh)} kWh/dia (E_mês ÷ 30)` : '—'} />
              <Linha k="Potência instalada da residência" v={`${num(ctx.consumo.potenciaInstaladaKw)} kW`} />
            </tbody>
          </table>
          {(!ctx.residencia.cidade || !ctx.residencia.uf) && (
            <div className="error-message">Esta residência não tem cidade/UF. Edite o imóvel para continuar.</div>
          )}

          <div className="field">
            <label htmlFor="consumo">Ajustar consumo de referência (kWh/mês) — opcional</label>
            <input id="consumo" inputMode="decimal" value={form.consumoKwhMes} onChange={(e) => set('consumoKwhMes', e.target.value)} placeholder="deixe vazio para usar o consumo calculado" />
          </div>
          <div className="field">
            <label htmlFor="pct">Percentual do consumo a atender (%)</label>
            <input id="pct" inputMode="decimal" value={form.percentualAtendimento} onChange={(e) => set('percentualAtendimento', e.target.value)} />
          </div>

          <h2 className="section-title">2. Recurso solar</h2>
          <div className="field">
            <label htmlFor="hsp">HSP — horas de sol pico (h/dia)</label>
            <input id="hsp" inputMode="decimal" value={form.hsp} onChange={(e) => set('hsp', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="hspFonte">Fonte da HSP</label>
            <input id="hspFonte" value={form.hspFonte} onChange={(e) => set('hspFonte', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pr">PR — desempenho global (0 a 1)</label>
            <input id="pr" inputMode="decimal" value={form.pr} onChange={(e) => set('pr', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="prj">Justificativa do PR</label>
            <input id="prj" value={form.prJustificativa} onChange={(e) => set('prJustificativa', e.target.value)} />
          </div>

          <h2 className="section-title">3. Módulos e dimensionamento</h2>
          <div className="field">
            <label htmlFor="painel">Módulo fotovoltaico (dataset)</label>
            <select id="painel" value={form.painelId} onChange={(e) => set('painelId', e.target.value)}>
              <option value="">Selecione…</option>
              {ctx.modulos.map((m) => <option key={m.id} value={m.id}>{m.fabricante} {m.modelo} — {m.potenciaWp} Wp — {brl(m.precoBrl)}</option>)}
            </select>
          </div>
          <button className="btn-primary btn-inline" onClick={dimensionar} disabled={ocupado || !form.painelId}>
            Dimensionar sistema
          </button>

          {pre && (
            <>
              <table className="table resultado-cenario">
                <tbody>
                  <Linha k="Potência FV necessária" v={`${num(pre.potenciaNecessariaKwp, 3)} kWp  (P_FV = E_dia ÷ (HSP × PR))`} />
                  <Linha k="Módulos" v={`${pre.quantidadeModulos} un. (arredondado para cima)`} />
                  <Linha k="Potência FV instalada" v={`${num(pre.potenciaInstaladaKwp, 3)} kWp`} />
                  <Linha k="Geração estimada" v={`${num(pre.geracao.geracaoDiariaKwh)} kWh/dia · ${num(pre.geracao.geracaoMensalKwh)} kWh/mês`} />
                  <Linha k="Atendimento do consumo" v={`${num(pre.geracao.atendimentoPercentual)}% (consumo ${num(pre.geracao.consumoMensalKwh)} × geração ${num(pre.geracao.geracaoMensalKwh)} kWh/mês)`} />
                  {pre.geracao.excedenteKwh > 0 && <Linha k="Energia compensada × excedente" v={`${num(pre.geracao.energiaCompensadaKwh)} kWh compensados · ${num(pre.geracao.excedenteKwh)} kWh excedentes`} />}
                </tbody>
              </table>

              <h2 className="section-title">4. Inversor</h2>
              <table className="table">
                <thead><tr><th></th><th>Inversor</th><th>Potência</th><th>CC/CA</th><th>Preço</th><th>Compatibilidade</th></tr></thead>
                <tbody>
                  {pre.inversores.map((i) => (
                    <tr key={i.id} style={{ opacity: i.compativel ? 1 : 0.6 }}>
                      <td>
                        <input type="radio" name="inv" disabled={!i.compativel} checked={String(form.inversorId) === String(i.id)}
                          onChange={() => setForm((f) => ({ ...f, inversorId: String(i.id) }))} aria-label={`Escolher ${i.modelo}`} />
                      </td>
                      <td>{i.fabricante} {i.modelo}{i.suportaBateria ? ' (híbrido)' : ''}</td>
                      <td>{num(i.potenciaKw)} kW</td><td>{i.razaoCcCa === null ? '—' : num(i.razaoCcCa)}</td><td>{brl(i.precoBrl)}</td>
                      <td>{i.compativel ? 'compatível' : `incompatível: ${i.motivos.join('; ')}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inversoresCompativeis.length === 0 && <div className="error-message">Nenhum inversor do dataset é compatível com este arranjo. Tente outro módulo ou ajuste o percentual de atendimento.</div>}

              <h2 className="section-title">5. Baterias (opcional)</h2>
              <div className="field">
                <label>
                  <input type="checkbox" checked={form.comBaterias} onChange={(e) => set('comBaterias', e.target.checked)} />{' '}
                  Incluir armazenamento por baterias (compara com e sem)
                </label>
              </div>
              {form.comBaterias && (
                <>
                  <div className="field">
                    <label htmlFor="bat">Bateria (dataset)</label>
                    <select id="bat" value={form.bateriaId} onChange={(e) => set('bateriaId', e.target.value)}>
                      <option value="">Selecione…</option>
                      {baterias.map((b) => <option key={b.id} value={b.id}>{b.fabricante} {b.modelo} — {num(b.capacidadeKwh)} kWh — DoD {b.dodPercentual}% — {brl(b.precoBrl)}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="aut">Autonomia desejada (horas, de 1 a 72)</label>
                    <input id="aut" inputMode="decimal" value={form.autonomiaHoras} onChange={(e) => set('autonomiaHoras', e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="hib">Inversor híbrido (suporta baterias)</label>
                    <select id="hib" value={form.inversorComBateriasId} onChange={(e) => set('inversorComBateriasId', e.target.value)}>
                      <option value="">Selecione…</option>
                      {hibridos.map((i) => <option key={i.id} value={i.id}>{i.fabricante} {i.modelo} — {brl(i.precoBrl)}</option>)}
                    </select>
                    {hibridos.length === 0 && <div className="field-error">Nenhum inversor híbrido compatível com este sistema e esta bateria.</div>}
                  </div>
                </>
              )}

              <h2 className="section-title">6. Economia e orçamento</h2>
              <div className="field">
                <label htmlFor="tarifa">Tarifa de energia (R$/kWh)</label>
                <input id="tarifa" inputMode="decimal" value={form.tarifaReaisKwh} onChange={(e) => set('tarifaReaisKwh', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="tarifaFonte">Fonte da tarifa</label>
                <input id="tarifaFonte" value={form.tarifaFonte} onChange={(e) => set('tarifaFonte', e.target.value)} placeholder="ex.: fatura da distribuidora" />
              </div>
              <div className="field">
                <label htmlFor="comp">Custos complementares (R$) — instalação, estrutura, cabeamento (opcional)</label>
                <input id="comp" inputMode="decimal" value={form.custoComplementarBrl} onChange={(e) => set('custoComplementarBrl', e.target.value)} />
              </div>
              {form.custoComplementarBrl !== '' && (
                <div className="field">
                  <label htmlFor="compd">Descrição dos custos complementares</label>
                  <input id="compd" value={form.custoComplementarDescricao} onChange={(e) => set('custoComplementarDescricao', e.target.value)} />
                </div>
              )}
              <button className="btn-primary btn-inline" onClick={calcular} disabled={ocupado || !form.inversorId}>
                Gerar proposta
              </button>
            </>
          )}
        </>
      )}

      {r && p && (
        <>
          <h2 className="section-title">Proposta — {r.alternativaSelecionada === 'com' ? 'com baterias' : 'sem baterias'}</h2>
          <table className="table resultado-cenario">
            <tbody>
              <Linha k="Residência" v={`${p.residencia.endereco} — ${p.residencia.cidade}/${p.residencia.uf}`} />
              <Linha k="Consumo" v={`${num(r.consumo.mensalKwh)} kWh/mês · ${num(r.consumo.diarioKwh)} kWh/dia`} />
              <Linha k="HSP / PR" v={`${num(r.recursoSolar.hsp)} h/dia (${r.recursoSolar.hspFonte}) · PR ${num(r.recursoSolar.pr)} — ${r.recursoSolar.prJustificativa}`} />
              <Linha k="Potência FV necessária / instalada" v={`${num(p.dimensionamento.potenciaNecessariaKwp, 3)} kWp / ${num(p.dimensionamento.potenciaInstaladaKwp, 3)} kWp`} />
              <Linha k="Módulos" v={`${p.dimensionamento.modulos.quantidade} × ${p.dimensionamento.modulos.fabricante} ${p.dimensionamento.modulos.modelo} (${p.dimensionamento.modulos.potenciaWp} Wp)`} />
              <Linha k="Inversor" v={`${p.dimensionamento.inversor.fabricante} ${p.dimensionamento.inversor.modelo} (${num(p.dimensionamento.inversor.potenciaKw)} kW) · CC/CA ${num(r.inversor.razaoCcCa)} · ${r.dimensionamento.arranjo.strings} string(s) de ${r.dimensionamento.arranjo.modulosPorString} módulos`} />
              <Linha k="Geração" v={`${num(p.geracao.diariaKwh)} kWh/dia · ${num(p.geracao.mensalKwh)} kWh/mês · atendimento ${num(p.geracao.atendimentoPercent)}%`} />
              {p.armazenamento.bateria && (
                <Linha k="Baterias e autonomia" v={`${p.armazenamento.bateria.quantidade} × ${p.armazenamento.bateria.fabricante} ${p.armazenamento.bateria.modelo} · ${num(p.armazenamento.bateria.capacidadeTotalKwh)} kWh instalados (necessário: ${num(r.armazenamento.capacidadeNominalNecessariaKwh)} kWh) · autonomia ${num(p.armazenamento.autonomiaHoras, 0)} h (${num(r.armazenamento.energiaAutonomiaKwh)} kWh)`} />
              )}
            </tbody>
          </table>

          <h3 className="section-title">Orçamento</h3>
          <Orcamento proposta={p} />

          <h3 className="section-title">Economia e payback</h3>
          <table className="table resultado-cenario">
            <tbody>
              <Linha k="Tarifa" v={`${brl(p.economia.tarifa.valorReaisKwh)}/kWh (${p.economia.tarifa.fonte})`} />
              <Linha k="Energia compensada" v={`${num(p.economia.energiaCompensadaKwhMes)} kWh/mês`} />
              <Linha k="Economia mensal / anual" v={`${brl(p.economia.economiaMensal)} / ${brl(p.economia.economiaAnual)}`} />
              <Linha k="Payback simples" v={p.payback.descricao} />
            </tbody>
          </table>

          {r.comparacao && (
            <>
              <h3 className="section-title">Comparação: sem × com baterias</h3>
              <table className="table">
                <thead><tr><th>Critério</th><th>Sem baterias</th><th>Com baterias</th><th>Diferença</th></tr></thead>
                <tbody>
                  {r.comparacao.criterios.map((c) => (
                    <tr key={c.chave}>
                      <td>{c.rotulo}{c.unidade ? ` (${c.unidade})` : ''}</td>
                      <td>{typeof c.sem === 'number' ? (c.unidade === 'R$' ? brl(c.sem) : num(c.sem)) : c.sem}</td>
                      <td>{typeof c.com === 'number' ? (c.unidade === 'R$' ? brl(c.com) : num(c.com)) : c.com}</td>
                      <td>{c.diferenca === undefined ? (c.igual ? 'igual' : 'diferente') : (c.unidade === 'R$' ? brl(c.diferenca) : num(c.diferenca))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>Payback simples (anos)</td>
                    <td>{num(r.semBaterias.payback.paybackAnos)}</td>
                    <td>{num(r.comBaterias.payback.paybackAnos)}</td>
                    <td>{r.semBaterias.payback.paybackAnos !== null && r.comBaterias.payback.paybackAnos !== null ? num(r.comBaterias.payback.paybackAnos - r.semBaterias.payback.paybackAnos) : '—'}</td>
                  </tr>
                </tbody>
              </table>
              <p>{leituraComparacao(r)}</p>
            </>
          )}

          <h3 className="section-title">Premissas e avisos</h3>
          <ul>
            {[...p.economia.premissas, ...p.payback.premissas].map((t, n) => <li key={n}>{t}</li>)}
            <li>Arranjo das strings simplificado: Voc a 25 °C, sem correção de temperatura; confirmar em projeto executivo.</li>
          </ul>
          {r.avisos.map((a, n) => <div key={n} className="error-message">{a}</div>)}

          <details>
            <summary>Memória de cálculo</summary>
            <table className="table">
              <thead><tr><th>Etapa</th><th>Fórmula</th><th>Resultado</th></tr></thead>
              <tbody>{r.memoriaCalculo.map((l, n) => <tr key={n}><td>{l.etapa}</td><td>{l.formula}</td><td>{num(l.resultado, 3)} {l.unidade}</td></tr>)}</tbody>
            </table>
          </details>

          <h2 className="section-title">7. Salvar e exportar</h2>
          <div className="field">
            <label htmlFor="titulo">Nome do projeto (opcional)</label>
            <input id="titulo" value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} />
          </div>
          <button className="btn-primary btn-inline" onClick={salvar} disabled={ocupado}>
            {projetoSalvoId ? 'Salvar nova versão' : 'Salvar projeto'}
          </button>
          {projetoSalvoId && (
            <>
              <button className="btn-secondary btn-inline" onClick={() => exportarProposta(projetoSalvoId)}>Ver proposta para o cliente</button>
              <button className="btn-secondary btn-inline" onClick={() => baixarProposta(projetoSalvoId)}>Baixar proposta (HTML)</button>
            </>
          )}
        </>
      )}
    </div>
  );
}
