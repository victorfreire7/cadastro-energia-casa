import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api.js';

const ELETRO_VAZIO = { nome: '', potenciaW: '', quantidade: '', horasDia: '' };

export default function ImovelForm() {
  const [endereco, setEndereco] = useState('');
  const [tipo, setTipo] = useState('residencial');
  const [eletrodomesticos, setEletrodomesticos] = useState([{ ...ELETRO_VAZIO }]);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const navigate = useNavigate();

  function atualizarEletro(index, campo, valor) {
    const copia = [...eletrodomesticos];
    copia[index][campo] = valor;
    setEletrodomesticos(copia);
  }

  function adicionarEletro() {
    setEletrodomesticos([...eletrodomesticos, { ...ELETRO_VAZIO }]);
  }

  function removerEletro(index) {
    setEletrodomesticos(eletrodomesticos.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const payload = {
        endereco,
        tipo,
        eletrodomesticos: eletrodomesticos
          .filter((el) => el.nome)
          .map((el) => ({
            nome: el.nome,
            potenciaW: Number(el.potenciaW),
            quantidade: Number(el.quantidade),
            horasDia: Number(el.horasDia)
          }))
      };
      await api.post('/imoveis', payload);
      navigate('/dashboard');
    } catch (err) {
      setErro(err.response?.data?.message || 'não foi possível cadastrar o imóvel');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="dashboard">
      <Link to="/dashboard" className="back-link">
        ← Voltar
      </Link>
      <h1>Cadastrar imóvel</h1>

      {erro && <div className="error-message">{erro}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="endereco">Endereço</label>
          <input id="endereco" value={endereco} onChange={(e) => setEndereco(e.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="tipo">Tipo</label>
          <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="residencial">Residencial</option>
            <option value="comercial">Comercial</option>
          </select>
        </div>

        <h2 className="section-title">Eletrodomésticos</h2>

        {eletrodomesticos.map((el, index) => (
          <div className="eletro-row" key={index}>
            <input
              placeholder="Nome"
              value={el.nome}
              onChange={(e) => atualizarEletro(index, 'nome', e.target.value)}
            />
            <input
              placeholder="Potência (W)"
              type="number"
              min="0.1"
              step="any"
              value={el.potenciaW}
              onChange={(e) => atualizarEletro(index, 'potenciaW', e.target.value)}
            />
            <input
              placeholder="Quantidade"
              type="number"
              min="1"
              step="1"
              value={el.quantidade}
              onChange={(e) => atualizarEletro(index, 'quantidade', e.target.value)}
            />
            <input
              placeholder="Horas/dia"
              type="number"
              min="0.1"
              max="24"
              step="any"
              value={el.horasDia}
              onChange={(e) => atualizarEletro(index, 'horasDia', e.target.value)}
            />
            {eletrodomesticos.length > 1 && (
              <button type="button" className="btn-remove" onClick={() => removerEletro(index)}>
                remover
              </button>
            )}
          </div>
        ))}

        <button type="button" className="btn-secondary btn-inline" onClick={adicionarEletro}>
          + Adicionar eletrodoméstico
        </button>

        <button className="btn-primary" type="submit" disabled={carregando}>
          {carregando ? 'Salvando...' : 'Salvar imóvel'}
        </button>
      </form>
    </div>
  );
}
