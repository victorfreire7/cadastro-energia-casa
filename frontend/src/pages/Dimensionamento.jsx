import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { UFS } from '../constants/ufs.js';

const ORIGEM_LABEL = {
  historico: 'média do histórico registrado',
  estimado: 'estimativa pelos eletrodomésticos cadastrados',
  manual: 'valor informado manualmente'
};

const HSP_FAIXA_PADRAO = { min: 3, max: 6.5 };

// PB03 — mesma faixa plausível do backend
function validarHspLocal(texto, faixa) {
  const valor = texto.trim().replace(',', '.');
  if (valor === '') return '';
  if (!/^-?\d+(\.\d+)?$/.test(valor)) return 'o HSP deve ser um número';
  const numero = Number(valor);
  if (numero < faixa.min || numero > faixa.max) {
    return `o HSP deve estar entre ${faixa.min} e ${faixa.max} h/dia`;
  }
  return '';
}

// PB04 — E_FV = C_m × f  (f = percentual / 100); mesma regra do backend
function calcularEnergiaFvLocal(consumo, percentual) {
  if (!Number.isFinite(consumo) || consumo <= 0) return null;
  if (!Number.isFinite(percentual) || percentual < 1 || percentual > 100) return null;
  return Number((consumo * (percentual / 100)).toFixed(2));
}

// PB02 — mesmas regras do backend, para feedback imediato
function validarPercentualLocal(texto) {
  const valor = texto.trim().replace(',', '.');
  if (valor === '') return 'informe o percentual (padrão: 100%)';
  if (!/^-?\d+(\.\d+)?$/.test(valor)) return 'o percentual deve ser um número';
  const numero = Number(valor);
  if (numero < 0) return 'o percentual não pode ser negativo';
  if (numero < 1 || numero > 100) return 'o percentual deve estar entre 1% e 100%';
  return '';
}

// PB12 — mesma faixa de autonomia do backend (horas)
function validarAutonomiaLocal(texto) {
  const valor = texto.trim().replace(',', '.');
  if (valor === '') return 'informe a autonomia desejada em horas';
  if (!/^-?\d+(\.\d+)?$/.test(valor)) return 'a autonomia deve ser um número';
  const numero = Number(valor);
  if (numero <= 0) return 'a autonomia deve ser um valor positivo';
  if (numero < 1 || numero > 72) return 'a autonomia deve estar entre 1 e 72 horas';
  return '';
}

export default function Dimensionamento() {
  const { imovelId } = useParams();
  const navigate = useNavigate();

  const [imoveis, setImoveis] = useState([]);
  const [referencia, setReferencia] = useState(null);
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  const [consumoManual, setConsumoManual] = useState('');
  const [percentual, setPercentual] = useState('100');
  const [erro, setErro] = useState('');
  const [erroPercentual, setErroPercentual] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [cenario, setCenario] = useState(null);
  const [hspTabela, setHspTabela] = useState(null);
  const [hspManual, setHspManual] = useState('');
  const [logs, setLogs] = useState(null);
  const [comArmazenamento, setComArmazenamento] = useState(false);
  const [autonomia, setAutonomia] = useState('');
  const [erroAutonomia, setErroAutonomia] = useState('');

  // PB01 task 2 — lista de imóveis para seleção
  useEffect(() => {
    api
      .get('/imoveis')
      .then(({ data }) => setImoveis(data))
      .catch(() => setErro('não foi possível carregar seus imóveis'))
      .finally(() => !imovelId && setCarregando(false));
  }, []);

  // PB01 tasks 1 e 3 — consumo e localidade já cadastrados
  useEffect(() => {
    if (!imovelId) {
      setReferencia(null);
      return;
    }
    setCarregando(true);
    setErro('');
    setCenario(null);
    setConsumoManual('');
    api
      .get(`/imoveis/${imovelId}/dimensionamento/referencia`)
      .then(({ data }) => {
        setReferencia(data);
        setCidade(data.localidade.cidade || '');
        setUf(data.localidade.uf || '');
      })
      .catch(() => setErro('não foi possível carregar os dados do imóvel'))
      .finally(() => setCarregando(false));
  }, [imovelId]);

  // PB03 — HSP associado à UF informada (recarrega ao ajustar a localidade)
  useEffect(() => {
    if (!uf) {
      setHspTabela(null);
      return;
    }
    api
      .get('/dimensionamento/hsp', { params: { uf } })
      .then(({ data }) => setHspTabela(data))
      .catch(() => setHspTabela(null));
  }, [uf]);

  const faixaHsp = hspTabela?.faixa || referencia?.faixaHsp || HSP_FAIXA_PADRAO;
  const erroHsp = validarHspLocal(hspManual, faixaHsp);
  const hspManualValido = hspManual.trim() !== '' && !erroHsp;
  const semHsp = !hspTabela && !hspManualValido;
  const hspEfetivo = hspManualValido ? Number(hspManual.replace(',', '.')) : hspTabela?.hsp;

  const manualPreenchido = consumoManual.trim() !== '';
  const manualNumero = Number(consumoManual.replace(',', '.'));
  const manualValido = manualPreenchido && Number.isFinite(manualNumero) && manualNumero > 0;

  // PB01 tasks 5 e 6 — sem referência (nem histórico/estimativa, nem manual) bloqueia o fluxo
  const semReferencia = referencia && !referencia.sugestao && !manualValido;
  const consumoEfetivo = manualValido ? manualNumero : referencia?.sugestao?.consumoKwhMes;
  const origemEfetiva = manualValido ? 'manual' : referencia?.sugestao?.origem;

  // PB04 — recalcula a cada mudança de consumo ou percentual
  const percentualNumero = Number(percentual.trim().replace(',', '.'));
  const energiaFv = calcularEnergiaFvLocal(consumoEfetivo, percentualNumero);

  function handleAutonomia(valor) {
    setAutonomia(valor);
    setErroAutonomia(validarAutonomiaLocal(valor));
  }

  function handlePercentual(valor) {
    setPercentual(valor);
    setErroPercentual(validarPercentualLocal(valor));
  }

  async function carregarLogs() {
    try {
      const { data } = await api.get(`/imoveis/${imovelId}/cenarios/${cenario.id}/logs`);
      setLogs(data);
    } catch (err) {
      setErro('não foi possível carregar a memória de cálculo');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');

    const erroLocal = validarPercentualLocal(percentual);
    if (erroLocal) {
      setErroPercentual(erroLocal);
      return;
    }
    if (manualPreenchido && !manualValido) {
      setErro('o consumo de referência deve ser um número maior que zero');
      return;
    }

    if (erroHsp) {
      setErro(erroHsp);
      return;
    }

    if (comArmazenamento) {
      const erroAut = validarAutonomiaLocal(autonomia);
      if (erroAut) {
        setErroAutonomia(erroAut);
        return;
      }
    }

    setSalvando(true);
    try {
      const { data } = await api.post(`/imoveis/${imovelId}/cenarios`, {
        cidade,
        uf,
        percentualAtendimento: percentual.trim().replace(',', '.'),
        ...(manualValido && { consumoReferenciaKwh: manualNumero }),
        ...(hspManualValido && { hspKwhM2Dia: hspEfetivo }),
        armazenamento: comArmazenamento,
        ...(comArmazenamento && { autonomiaHoras: autonomia.trim().replace(',', '.') })
      });
      setCenario(data);
      setLogs(null);
    } catch (err) {
      setErro(err.response?.data?.message || 'não foi possível salvar o cenário');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="dashboard">
      <Link to="/dashboard" className="back-link">
        ← Voltar
      </Link>
      <h1>Dimensionamento fotovoltaico</h1>
      <p className="imovel-meta">Passo 1 — consumo de referência, localização, HSP e percentual de atendimento</p>

      {erro && <div className="error-message">{erro}</div>}

      <div className="field">
        <label htmlFor="imovel">Imóvel de referência</label>
        <select
          id="imovel"
          value={imovelId || ''}
          onChange={(e) => navigate(e.target.value ? `/dimensionamento/novo/${e.target.value}` : '/dimensionamento/novo')}
        >
          <option value="">Selecione um imóvel</option>
          {imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.endereco}
            </option>
          ))}
        </select>
      </div>

      {imovelId && carregando && <p>Carregando...</p>}

      {referencia && !carregando && !cenario && (
        <form onSubmit={handleSubmit}>
          <h2 className="section-title">Localização</h2>
          <div className="localidade-row">
            <div className="field">
              <label htmlFor="cidade">Cidade</label>
              <input id="cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="uf">UF</label>
              <select id="uf" value={uf} onChange={(e) => setUf(e.target.value)} required>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="imovel-meta">
            {referencia.localidade.cidade
              ? `Localidade cadastrada: ${referencia.localidade.cidade}/${referencia.localidade.uf}. Confirme ou ajuste.`
              : 'Este imóvel ainda não tem localidade cadastrada. Informe cidade e UF.'}
          </p>

          <h2 className="section-title">Consumo de referência</h2>
          {referencia.sugestao ? (
            <>
              <p className="metric total-consumo">{referencia.sugestao.consumoKwhMes} kWh/mês</p>
              <p className="imovel-meta">
                Origem: {ORIGEM_LABEL[referencia.sugestao.origem]}
                {referencia.sugestao.origem === 'historico' &&
                  ` (${referencia.sugestao.mesesHistorico} ${referencia.sugestao.mesesHistorico === 1 ? 'mês' : 'meses'})`}
                .
              </p>
              {referencia.sugestao.origem === 'estimado' && (
                <p className="imovel-meta">
                  Ainda não há histórico mensal (mínimo: {referencia.historicoMinimoMeses}). Registre uma leitura
                  no detalhe do imóvel para usar o consumo real.
                </p>
              )}
            </>
          ) : (
            <div className="error-message">
              Este imóvel não tem consumo de referência: não há histórico registrado nem eletrodomésticos
              cadastrados. Registre o consumo no imóvel ou informe o valor manualmente abaixo para continuar.
            </div>
          )}

          <div className="field">
            <label htmlFor="consumoManual">Ajustar consumo de referência (kWh/mês) — opcional</label>
            <input
              id="consumoManual"
              type="number"
              min="0.01"
              step="any"
              placeholder={referencia.sugestao ? `Deixe vazio para usar ${referencia.sugestao.consumoKwhMes}` : 'Ex.: 350'}
              value={consumoManual}
              onChange={(e) => setConsumoManual(e.target.value)}
            />
          </div>

          <h2 className="section-title">Percentual do consumo a atender</h2>
          <div className="field">
            <label htmlFor="percentual">Percentual (1% a 100%)</label>
            <input
              id="percentual"
              type="number"
              min="1"
              max="100"
              step="any"
              value={percentual}
              onChange={(e) => handlePercentual(e.target.value)}
              aria-invalid={erroPercentual ? 'true' : 'false'}
            />
            {erroPercentual && <div className="field-error">{erroPercentual}</div>}
          </div>
          <button type="button" className="btn-secondary btn-inline" onClick={() => handlePercentual('100')}>
            Usar 100%
          </button>

          <h2 className="section-title">Recurso solar (HSP)</h2>
          {hspTabela ? (
            <>
              <p className="metric total-consumo">{hspTabela.hsp} h/dia</p>
              <p className="imovel-meta">
                Região {hspTabela.regiao} ({hspTabela.uf}). Fonte: {hspTabela.fonte}.
              </p>
            </>
          ) : (
            <div className="error-message">
              {uf
                ? 'Não há HSP cadastrado para esta UF. Informe o HSP manualmente.'
                : 'Informe a UF para carregar o HSP da localidade.'}
            </div>
          )}
          <div className="field">
            <label htmlFor="hspManual">
              Sobrescrever HSP (h/dia, entre {faixaHsp.min} e {faixaHsp.max}) — opcional
            </label>
            <input
              id="hspManual"
              type="number"
              step="any"
              min={faixaHsp.min}
              max={faixaHsp.max}
              value={hspManual}
              onChange={(e) => setHspManual(e.target.value)}
              aria-invalid={erroHsp ? 'true' : 'false'}
            />
            {erroHsp && <div className="field-error">{erroHsp}</div>}
            {hspManualValido && (
              <div className="imovel-meta">Será usado o valor informado manualmente em vez da tabela.</div>
            )}
          </div>

          <h2 className="section-title">Armazenamento por baterias</h2>
          <div className="field">
            <label htmlFor="armazenamento">Sistema de armazenamento</label>
            <select
              id="armazenamento"
              value={comArmazenamento ? 'com' : 'sem'}
              onChange={(e) => {
                setComArmazenamento(e.target.value === 'com');
                setErroAutonomia('');
              }}
            >
              <option value="sem">Sem baterias</option>
              <option value="com">Com baterias</option>
            </select>
          </div>
          {comArmazenamento ? (
            <div className="field">
              <label htmlFor="autonomia">Autonomia desejada (horas, entre 1 e 72)</label>
              <input
                id="autonomia"
                type="number"
                min="1"
                max="72"
                step="any"
                value={autonomia}
                onChange={(e) => handleAutonomia(e.target.value)}
                aria-invalid={erroAutonomia ? 'true' : 'false'}
              />
              {erroAutonomia && <div className="field-error">{erroAutonomia}</div>}
            </div>
          ) : (
            <p className="imovel-meta">Sem baterias: o custo de baterias é considerado R$ 0,00.</p>
          )}

          <h2 className="section-title">Energia mensal a gerar (E_FV)</h2>
          {energiaFv !== null ? (
            <>
              <p className="metric total-consumo">{energiaFv} kWh/mês</p>
              <p className="imovel-meta">
                E_FV = C_m × f = {consumoEfetivo} kWh/mês × {percentualNumero / 100}
              </p>
            </>
          ) : (
            <p className="imovel-meta">
              Defina um consumo de referência válido e um percentual entre 1% e 100% para calcular.
            </p>
          )}

          <button
            className="btn-primary"
            type="submit"
            disabled={salvando || semReferencia || semHsp || !!erroPercentual || !!erroHsp || !!erroAutonomia}
          >
            {salvando ? 'Salvando...' : 'Salvar cenário e continuar'}
          </button>
          {semReferencia && (
            <p className="imovel-meta">Defina um consumo de referência para avançar.</p>
          )}
        </form>
      )}

      {cenario && (
        <div className="resultado-cenario">
          <h2 className="section-title">Cenário salvo</h2>
          <table className="table">
            <tbody>
              <tr>
                <th>Localidade</th>
                <td>
                  {cenario.cidade}/{cenario.uf}
                </td>
              </tr>
              <tr>
                <th>Consumo de referência</th>
                <td className="metric">{cenario.consumoReferenciaKwh} kWh/mês</td>
              </tr>
              <tr>
                <th>Origem do consumo</th>
                <td>{ORIGEM_LABEL[cenario.consumoOrigem]}</td>
              </tr>
              <tr>
                <th>Percentual a atender</th>
                <td className="metric">{cenario.percentualAtendimento}%</td>
              </tr>
              <tr>
                <th>Energia mensal a gerar (E_FV)</th>
                <td className="metric">{cenario.energiaMensalFvKwh} kWh/mês</td>
              </tr>
              <tr>
                <th>HSP utilizado</th>
                <td className="metric">{cenario.hspKwhM2Dia} h/dia</td>
              </tr>
              <tr>
                <th>Origem do HSP</th>
                <td>{cenario.hspFonte}</td>
              </tr>
              <tr>
                <th>Armazenamento</th>
                <td>
                  {cenario.armazenamento
                    ? `Com baterias (autonomia de ${cenario.autonomiaHoras} h)`
                    : 'Sem baterias'}
                </td>
              </tr>
              <tr>
                <th>Custo de baterias</th>
                <td className="metric">R$ {Number(cenario.custoBateriaBrl).toFixed(2).replace('.', ',')}</td>
              </tr>
            </tbody>
          </table>
          <button className="btn-secondary btn-inline" onClick={carregarLogs}>
            {logs ? 'Atualizar memória de cálculo' : 'Ver memória de cálculo'}
          </button>
          {logs && (
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Fórmula</th>
                  <th>Entradas</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{new Date(l.createdAt).toLocaleString('pt-BR')}</td>
                    <td>{l.formula}</td>
                    <td>
                      C_m = {l.entradas.C_m_kWh_mes} kWh/mês; f = {l.entradas.f_percentual}%
                    </td>
                    <td className="metric">
                      {l.resultado} {l.unidade}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="btn-secondary btn-inline" onClick={() => setCenario(null)}>
            Editar parâmetros
          </button>
        </div>
      )}
    </div>
  );
}
