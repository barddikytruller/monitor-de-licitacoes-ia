
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function gerarFiltrosComIA(pedido, tentativas = 3) {
    console.log(`\n[ETAPA 1: IA] Recebido pedido do usuário: "${pedido}"`);
    console.log('[ETAPA 1: IA] Traduzindo pedido em filtros para o scraper...');
    
    const prompt = `Você é um assistente especialista em traduzir pedidos em linguagem natural para filtros de busca. Sua tarefa é converter o "Pedido do Usuário" em um objeto JSON com as chaves: "objeto", "uf", e "tipo". Regras: - "objeto": Extraia o principal produto ou serviço. - "uf": Extraia o estado e retorne a sigla de 2 letras (ex: São Paulo -> SP). Se não houver, use "". - "tipo": Retorne "servico" ou "material". Se ambíguo, use "servico". Pedido do Usuário: "${pedido}"`;

    for (let i = 1; i <= tentativas; i++) {
        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            const jsonText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const filtros = JSON.parse(jsonText);
            
            console.log('[ETAPA 1: IA] ✅ Filtros gerados com sucesso:', filtros);
            return filtros;

        } catch (error) {
            
            if (error.message.includes('429')) {
                console.error(`[ETAPA 1: IA] ❌ Erro: A cota diária de requisições gratuitas para a API do Gemini foi excedida.`);
                console.error('[ETAPA 1: IA] Por favor, aguarde o dia seguinte ou configure o faturamento no Google Cloud Console.');
                return null; 
            }
            
            if (error.message.includes('503')) {
                console.warn(`[ETAPA 1: IA] ⚠️ Servidor da IA sobrecarregado. Tentativa ${i} de ${tentativas}. Tentando novamente em 5 segundos...`);
                if (i < tentativas) {
                    await sleep(5000);
                } else {
                    console.error(`[ETAPA 1: IA] ❌ Erro final: O servidor da IA continuou sobrecarregado após ${tentativas} tentativas.`);
                    return null;
                }
            } else {
                console.error("[ETAPA 1: IA] ❌ Erro inesperado ao gerar filtros:", error);
                return null;
            }
        }
    }
}

module.exports = { gerarFiltrosComIA };