
const readResponseText = async response => {
  const needTransCharset = ['charset=gbk', 'charset=GBK']
  const contentType = response.headers.get('content-type') || ''
  const needTrans = needTransCharset.some(i => contentType.includes(i))

  if (needTrans) {
    const res = await response.arrayBuffer()
    const decoder = new TextDecoder('gbk')
    return decoder.decode(res)
  }

  return response.text()
}

// fetch函数
function fetchSearchSuggestions(url, returnResponse) {
  return new Promise(async(resolve, reject) => {
    try {
      // 发起跨域请求
      const response = await fetch(url, {
        method: 'GET',
        referrerPolicy: 'no-referrer', // 设置 Referrer Policy
      });
  
      // 检查响应状态
      if (!response.ok) {
        reject(new Error(`HTTP error! status: ${response.status}`));
        return
      }

      // 根据returnResponse标志决定是否直接返回Response对象
      if (returnResponse) {
        resolve(response)
      } else {
        resolve(await readResponseText(response))
      }

    } catch (error) {
      console.error('获取搜索建议时出错:', error);
      reject(error)
    }
  })

}

// 监听来自内容脚本的消息
function fetchNetworkBlob(url) {
  return fetchSearchSuggestions(url, true).then(async res => {
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > 50 * 1024 * 1024) {
      throw new Error('Network resource is too large')
    }
    return {
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      data: Array.from(new Uint8Array(buffer))
    }
  })
}

function fetchTextResource(url) {
  return fetchSearchSuggestions(url, true).then(async res => {
    return {
      contentType: res.headers.get('content-type') || '',
      data: await readResponseText(res),
      finalUrl: res.url || url
    }
  })
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FETCH_SEARCH_SUGGESTIONS') {
    const { url } = request.payload;

    // 使用 Promise 处理异步请求
    fetchSearchSuggestions(url)
      .then(suggestions => {
        sendResponse({ 
          success: true, 
          data: suggestions 
        });
      })
      .catch(error => {
        sendResponse({ 
          success: false, 
          error: error 
        });
      });

    // 表示将异步发送响应
    return true;
  } else if (request.type === 'FETCH_NETWORK_SOURCE_CONTENT_TYPE') {
    const { url } = request.payload;

    // 使用 Promise 处理异步请求
    fetchSearchSuggestions(url, true)
      .then(res => {
        sendResponse({
          success: true, 
          data: res.headers.get('content-type')
        });
      })
      .catch(error => {
        sendResponse({ 
          success: false, 
          error: error 
        });
      });

    // 表示将异步发送响应
    return true;
  } else if (request.type === 'FETCH_TEXT_RESOURCE') {
    const { url } = request.payload;

    fetchTextResource(url)
      .then(res => {
        sendResponse({
          success: true,
          contentType: res.contentType,
          data: res.data,
          finalUrl: res.finalUrl
        });
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error
        });
      });

    return true;
  } else if (request.type === 'FETCH_WALLPAPER_BLOB') {
    const { url } = request.payload;

    fetchNetworkBlob(url)
      .then(res => {
        sendResponse({
          success: true,
          contentType: res.contentType,
          data: res.data
        });
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error
        });
      });

    return true;
  } else if (request.type === 'FEICH_HOST_FAVICON') {
    const { url } = request.payload;

    // 使用 Promise 处理异步请求
    fetchTextResource(url)
      .then(res => {
        sendResponse({
          success: true, 
          data: res.data,
          finalUrl: res.finalUrl,
          contentType: res.contentType
        });
      })
      .catch(error => {
        sendResponse({ 
          success: false, 
          error: error 
        });
      });

    // 表示将异步发送响应
    return true;
  }
});
