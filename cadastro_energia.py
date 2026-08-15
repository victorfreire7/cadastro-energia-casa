import json
import os

CAMINHO_JSON = os.path.join(os.path.dirname(__file__), "eletrodomesticos.json")


def carregar_eletrodomesticos():
    with open(CAMINHO_JSON, "r", encoding="utf-8") as arquivo:
        return json.load(arquivo)


def perguntar_quantidade(item):
    while True:
        resposta = input(f"Quantos(as) {item['nome']} você tem? ").strip()
        if resposta.isdigit():
            os.system("cls" if os.name == "nt" else "clear")
            return int(resposta)
        print("Digite um número inteiro maior ou igual a zero.")


def main():
    eletrodomesticos = carregar_eletrodomesticos()

    selecionados = []
    for item in eletrodomesticos:
        quantidade = perguntar_quantidade(item)
        if quantidade > 0:
            selecionados.append((item, quantidade))

    total_watts_mensal = sum(item["watts_mensal"] * quantidade for item, quantidade in selecionados)

    print("\n===== CADASTRO DA CASA =====")
    print("Eletrodomésticos cadastrados:")
    for item, quantidade in selecionados:
        subtotal = item["watts_mensal"] * quantidade
        print(f"  - {item['nome']} x{quantidade}: {subtotal:.2f} watts/mês")
    print(f"\nConsumo total estimado: {total_watts_mensal:.2f} watts/mês")


if __name__ == "__main__":
    main()
