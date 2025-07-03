

const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const querystring = require('querystring');

const URL_BASE = 'http://comprasnet.gov.br/ConsultaLicitacoes/';
const URL_FILTRO = `${URL_BASE}ConsLicitacao_Filtro.asp`;
const URL_ACAO = `${URL_BASE}ConsLicitacao_Relacao.asp`;
const headersDoNavegador = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'cache-control': 'max-age=0',
    'referer': URL_FILTRO, 'origin': 'http://comprasnet.gov.br',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};
function construirCorpoRequisicao(data) {
    const corpo = [];
    for (const chave in data) {
        const valor = data[chave];
        if (Array.isArray(valor)) {
            valor.forEach(v => { corpo.push(`${encodeURIComponent(chave)}=${encodeURIComponent(v)}`); });
        } else {
            corpo.push(`${encodeURIComponent(chave)}=${encodeURIComponent(valor)}`);
        }
    }
    return corpo.join('&');
}

function extrairDadosDaPagina(html) {
    const $ = cheerio.load(html);
    const licitacoesPagina = [];
    $('tr.tex3').each((i, el) => {
        const celula = $(el).find('td[style="padding:10px"]');
        if (celula.length > 0) {
            const textoCompleto = celula.text();
            const htmlCompleto = celula.html();
            const orgao = textoCompleto.split('Código da UASG:')[0].trim().replace(/\s+/g, ' ');
            const uasg = textoCompleto.match(/Código da UASG: (\d+)/)?.[1] || null;
            const modalidade = textoCompleto.match(/(Pregão Eletrônico Nº \d+\/\d+)|(Concorrência Nº \d+\/\d+)|(Tomada de Preços Nº \d+\/\d+)/)?.[0] || 'Modalidade não encontrada';
            let objeto = htmlCompleto.match(/<b>Objeto:<\/b>&nbsp;(?:Objeto: )?(.*?)<br>/)?.[1] || 'Objeto não encontrado';
            objeto = objeto.trim().replace(/<br>/g, ' ');
            const aberturaProposta = textoCompleto.match(/Abertura da Proposta:.*?em (\d{2}\/\d{2}\/\d{4}) às (\d{2}:\d{2}Hs)/);
            
            
            licitacoesPagina.push({
                fonte: 'ComprasNet',
                orgao, uasg, 
                modalidade: modalidade.replace(/\s+/g, ' '), 
                objeto,
                dataAbertura: aberturaProposta ? aberturaProposta[1] : null,
                horaAbertura: aberturaProposta ? aberturaProposta[2] : null,
            });
        }
    });
    return licitacoesPagina;
}



async function buscarComprasNet(filtros) {
    if (!filtros) { return []; }
    console.log('\n[ComprasNet] Iniciando busca...');
    const cookieJar = new CookieJar();
    const client = wrapper(axios.create({ jar: cookieJar }));

    try {
        await client.get(URL_FILTRO, { headers: headersDoNavegador });
        console.log('[ComprasNet] ✅ Cookie de sessão obtido.');

        
        const ontem = new Date();
        ontem.setDate(ontem.getDate() - 1);
        const dataFormatada = `${String(ontem.getDate()).padStart(2, '0')}/${String(ontem.getMonth() + 1).padStart(2, '0')}/${ontem.getFullYear()}`;
        
        console.log(`[ComprasNet] Período de busca ajustado para ontem: ${dataFormatada}`);

        let objetoDaBusca = (filtros.objeto || '').toLowerCase();
        if (['licitações', 'qualquer licitação', 'qualquer'].includes(objetoDaBusca)) {
            objetoDaBusca = '';
        } else {
            objetoDaBusca = objetoDaBusca.replace('ç', 'c');
        }

        const formData = {
            numprp: '', 
            dt_publ_ini: dataFormatada, 
            dt_publ_fim: dataFormatada, 
            txtObjeto: objetoDaBusca,
            chkModalidade: ['1', '2', '3', '20', '5', '99'],
            chkTodos: '-1', chk_concor: ['31', '32', '41', '42', '49'], chk_concorTodos: '-1',
            chk_pregao: ['1', '2', '3', '4'], chk_pregaoTodos: '-1',
            chk_rdc: ['1', '2', '3', '4'], chk_rdcTodos: '-1',
            optTpPesqMat: filtros.tipo === 'servico' ? 'N' : (filtros.tipo === 'material' ? 'M' : ''),
            optTpPesqServ: filtros.tipo === 'servico' ? 'S' : (filtros.tipo === 'material' ? 'N' : ''),
            txtlstUasg: '', txtlstUf: filtros.uf || '', txtlstMunicipio: '', txtlstModalidade: '',
            txtlstTpPregao: '', txtlstConcorrencia: '', txtlstGrpMaterial: '',
            txtlstClasMaterial: '', txtlstMaterial: '', txtlstGrpServico: '',
            txtlstServico: '', Origem: 'F'
        };
        
        const dadosFormatados = construirCorpoRequisicao(formData);
        const bufferCodificado = iconv.encode(dadosFormatados, 'latin1');
        
        const responsePagina1 = await client.post(URL_ACAO, bufferCodificado, {
            headers: { ...headersDoNavegador, 'Content-Type': 'application/x-www-form-urlencoded' },
            responseType: 'arraybuffer',
        });
        const htmlPagina1 = iconv.decode(responsePagina1.data, 'iso-8859-1');

        
        const $ = cheerio.load(htmlPagina1);
        if ($('.mensagem').text().includes('Não existe licitação')) {
            console.log('[ComprasNet] ✅ Busca concluída. O site informou que não há resultados para estes filtros.');
            return [];
        }
        let todasAsLicitacoes = extrairDadosDaPagina(htmlPagina1);
        const textoPaginacao = $('td.td_titulo_campo center').text();
        const totalLicitacoesMatch = textoPaginacao.match(/de (\d+)/);
        if (totalLicitacoesMatch) {
            const totalPaginas = Math.ceil(parseInt(totalLicitacoesMatch[1], 10) / 10);
            if(totalPaginas > 1) {
                console.log(`[ComprasNet] Paginação detectada. Total de ${totalLicitacoesMatch[1]} licitações em ${totalPaginas} páginas.`);
                for (let i = 2; i <= totalPaginas; i++) {
                    console.log(`[ComprasNet] Buscando página ${i} de ${totalPaginas}...`);
                    const urlPagina = `${URL_ACAO}?${dadosFormatados}&numpag=${i}`;
                    const responsePagina = await client.get(urlPagina, { headers: headersDoNavegador, responseType: 'arraybuffer' });
                    const htmlPagina = iconv.decode(responsePagina.data, 'iso-8859-1');
                    todasAsLicitacoes.push(...extrairDadosDaPagina(htmlPagina));
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }
        console.log(`[ComprasNet] ✅ Extração concluída. ${todasAsLicitacoes.length} licitações encontradas.`);
        return todasAsLicitacoes;
    } catch (error) {
        console.error('[ComprasNet] ❌ Erro ao buscar licitações:', error.message);
        return [];
    }
}

module.exports = { buscarComprasNet };