import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { UFS } from '../constants/ufs.js';

const ORIGEM_LABEL = {
  historico: 'média do histórico registrado',
  estimado: 'estimativa pelos eletrodomésticos cadastrados',
  manual: 'valor informado manualmente'
};

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

  const manualPreenchido = consumoManual.trim() !== '';
  const manualNumero = Number(consumoManual.replace(',', '.'));
  const manualValido = manualPreenchido && Number.isFinite(manualNumero) && manualNumero > 0;

  // PB01 tasks 5 e 6 — sem referência (nem histórico/estimativa, nem manual) bloqueia o fluxo
  const semReferencia = referencia && !referencia.sugestao && !manualValido;
  const consumoEfetivo = manualValido ? manualNumero : referencia?.sugestao?.consumoKwhMes;
  const origemEfetiva = manualValido ? 'manual' : referencia?.sugestao?.origem;

  function handlePercentual(valor) {
    setPercentual(valor);
    setErroPercentual(validarPercentualLocal(valor));
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

    setSalvando(true);
    try {
      const { data } = await api.post(`/imoveis/${imovelId}/cenarios`, {
        cidade,
        uf,
        percentualAtendimento: percentual.trim().replace(',', '.'),
        ...(manualValido && { consumoReferenciaKwh: manualNumero })
      });
      setCenario(data);
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
      <p className="imovel-meta">Passo 1 — consumo de referência, localização e percentual de atendimento</p>

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

          <button
            className="btn-primary"
            type="submit"
            disabled={salvando || semReferencia || !!erroPercentual}
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
            </tbody>
          </table>
          <button className="btn-secondary btn-inline" onClick={() => setCenario(null)}>
            Editar parâmetros
          </button>
        </div>
      )}
    </div>
  );
}
