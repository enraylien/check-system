// =====================================================================
// 馭睿的支票流通查詢系統 - 前端應用程式邏輯
// =====================================================================

// ---- 設定 ----
const CONFIG = {
  DEFAULT_API_URL: 'https://script.google.com/macros/s/AKfycbwzuODIJLp6BR3Un_diZ_bvGr1Wp2vZHhZQnAQgjpRJrReoboqAw5xGasHc_pozg6rA/exec',
  API_URL_KEY: 'check_api_url',
  URGENT_DAYS_KEY: 'check_urgent_days',
  WARN_DAYS_KEY: 'check_warn_days',
  CACHE_KEY: 'check_data_cache',
  CACHE_TIME_KEY: 'check_cache_time',
  CACHE_TTL: 5 * 60 * 1000, // 5 分鐘快取
  get urgentDays() { return parseInt(localStorage.getItem(this.URGENT_DAYS_KEY) || '7'); },
  get warnDays() { return parseInt(localStorage.getItem(this.WARN_DAYS_KEY) || '30'); },
  get apiUrl() { return localStorage.getItem(this.API_URL_KEY) || this.DEFAULT_API_URL; }
};

// ---- 應用程式狀態 ----
let appState = {
  checks: [],         // 所有支票資料
  filtered: [],       // 篩選後資料
  currentFilter: 'all',
  currentSort: 'urgency',
  searchQuery: '',
  isLoading: false,
  lastLoaded: null,
  currentCheck: null,
  pendingAttachments: []
};

// =====================================================================
// 初始化
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  // 註冊 Service Worker
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js?v=3.0.3', { updateViaCache: 'none' });
      await registration.update();
    } catch (e) {
      console.log('SW 註冊失敗:', e);
    }
  }

  // 綁定事件
  bindEvents();

  // 讀取設定
  loadSettings();

  // 載入資料
  await loadChecks();

  // 檢查到期警示
  checkExpiryAlerts();
}

// =====================================================================
// 事件綁定
// =====================================================================
function bindEvents() {
  // 重新整理
  document.getElementById('btnRefresh').addEventListener('click', () => {
    clearCache();
    loadChecks(true);
  });

  // 同步按鈕
  document.getElementById('btnSync').addEventListener('click', () => {
    loadChecks(true);
  });

  // 搜尋
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value.trim();
    document.getElementById('btnClearSearch').style.display =
      appState.searchQuery ? 'block' : 'none';
    applyFiltersAndSort();
  });
  document.getElementById('btnClearSearch').addEventListener('click', () => {
    searchInput.value = '';
    appState.searchQuery = '';
    document.getElementById('btnClearSearch').style.display = 'none';
    applyFiltersAndSort();
  });

  // 篩選標籤
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      appState.currentFilter = tab.dataset.filter;
      applyFiltersAndSort();
    });
  });

  // 排序
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    appState.currentSort = e.target.value;
    applyFiltersAndSort();
  });

  // FAB - 新增支票
  document.getElementById('btnAdd').addEventListener('click', () => openModal());

  // Modal 關閉
  document.getElementById('btnModalClose').addEventListener('click', closeModal);
  document.getElementById('checkModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('checkModal')) closeModal();
  });

  document.getElementById('cameraButton').addEventListener('click', () => {
    document.getElementById('cameraInput').click();
  });
  document.getElementById('cameraInput').addEventListener('change', uploadSelectedAttachment);
  document.getElementById('attachmentInput').addEventListener('change', uploadSelectedAttachment);
  document.getElementById('btnAttachmentClose').addEventListener('click', closeAttachmentPreview);
  document.getElementById('attachmentModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('attachmentModal')) closeAttachmentPreview();
  });

  // 儲存支票
  document.getElementById('btnSaveCheck').addEventListener('click', saveCheck);

  // 刪除支票
  document.getElementById('btnDeleteCheck').addEventListener('click', () => {
    const checkId = document.getElementById('editCheckId').value;
    if (checkId && confirm('確定要刪除這張支票嗎？（可由試算表備份還原）')) {
      deleteCheck(checkId);
    }
  });

  // 詳情關閉
  document.getElementById('btnDetailClose').addEventListener('click', closeDetailModal);
  document.getElementById('btnDetailClose2').addEventListener('click', closeDetailModal);
  document.getElementById('detailModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('detailModal')) closeDetailModal();
  });
  document.getElementById('btnDetailEdit').addEventListener('click', () => {
    closeDetailModal();
    const checkId = document.getElementById('btnDetailEdit').dataset.checkId;
    const check = findCheckById(checkId);
    if (check) openModal(check);
    else recoverInvalidCheckSelection();
  });

  // 底部導航
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      handleNavigation(page);
    });
  });

  // 金額自動換算大寫
  document.getElementById('formAmount').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (val && !isNaN(val)) {
      const cn = numberToChinese(val);
      document.getElementById('amountCNDisplay').textContent = cn;
      document.getElementById('formAmountCN').value = cn;
    } else {
      document.getElementById('amountCNDisplay').textContent = '';
    }
  });

  // 狀態選擇
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('formStatus').value = btn.dataset.status;
    });
  });

  // 快速選擇按鈕
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) target.value = btn.dataset.value;
    });
  });

  // 統計卡片點擊
  document.getElementById('statUrgent').addEventListener('click', () => {
    setFilter('urgent');
    showToast('⚡ 顯示 7 天內到期支票', 'info');
  });
  document.getElementById('statCirculating').addEventListener('click', () => {
    setFilter('⏳ 流通中');
    showToast('⏳ 顯示流通中支票', 'info');
  });
  document.getElementById('statOverdue').addEventListener('click', () => {
    setFilter('overdue');
    showToast('⚠️ 顯示已過期支票', 'warning');
  });
}

// =====================================================================
// 資料載入
// =====================================================================
async function loadChecks(forceRefresh = false) {
  const apiUrl = CONFIG.apiUrl;
  if (!apiUrl) {
    // 沒有 API URL，嘗試用快取或提示設定
    const cached = getCachedData();
    if (cached) {
      appState.checks = cached;
      applyFiltersAndSort();
      updateStats();
      showToast('⚠️ 請先在設定中填入 Apps Script 網址', 'warning', 5000);
    } else {
      showEmptyState('請先設定 API 網址', '點擊右下角底部導航的「設定」，填入您的 Google Apps Script 網址後重試。');
    }
    return;
  }

  // 嘗試使用快取
  if (!forceRefresh) {
    const cached = getCachedData();
    if (cached) {
      appState.checks = cached;
      applyFiltersAndSort();
      updateStats();
      return;
    }
  }

  setLoading(true);
  try {
    let result;
    try {
      result = await fetchChecksFromApi(apiUrl);
    } catch (error) {
      // 舊版手機可能仍保存不含永久 ID 的測試 API 網址；僅在確認
      // 回傳資料缺少 ID 時，才自動改回正式 API，避免誤開第一張支票。
      if (error.code === 'INVALID_CHECK_IDS' && apiUrl !== CONFIG.DEFAULT_API_URL) {
        result = await fetchChecksFromApi(CONFIG.DEFAULT_API_URL);
        localStorage.setItem(CONFIG.API_URL_KEY, CONFIG.DEFAULT_API_URL);
        showToast('⚠️ 已淘汰舊資料來源，改用正式支票資料', 'warning', 5000);
      } else {
        throw error;
      }
    }

    if (result.success) {
      appState.checks = result.data;
      setCachedData(appState.checks);
      applyFiltersAndSort();
      updateStats();
      updatePayeeDatalist();
      showToast(`✅ 已載入 ${appState.checks.length} 筆支票`, 'success');
    } else {
      throw new Error(result.error || '載入失敗');
    }
  } catch (err) {
    console.error('載入失敗:', err);
    // 嘗試使用快取
    const cached = getCachedData();
    if (cached) {
      appState.checks = cached;
      applyFiltersAndSort();
      updateStats();
      showToast('⚠️ 網路錯誤，顯示快取資料', 'warning');
    } else {
      showToast(`❌ 載入失敗: ${err.message}`, 'error');
      showEmptyState('載入失敗', `${err.message}\n\n請確認 API 網址設定正確，且已授權 Apps Script。`);
    }
  } finally {
    setLoading(false);
  }
}

async function fetchChecksFromApi(apiUrl) {
  const response = await fetch(`${apiUrl}?action=getAll`, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-cache'
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (!result.success) throw new Error(result.error || '載入失敗');

  const checks = Array.isArray(result.data) ? result.data : [];
  if (!hasValidUniqueCheckIds(checks)) {
    const error = new Error('支票資料缺少永久 ID，已停止顯示以避免開啟或編輯錯誤支票');
    error.code = 'INVALID_CHECK_IDS';
    throw error;
  }
  return { ...result, data: checks };
}

// =====================================================================
// 篩選與排序
// =====================================================================
function applyFiltersAndSort() {
  let result = [...appState.checks];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 加入計算欄位
  result = result.map(c => {
    const due = parseDate(c.dueDate);
    let daysUntilDue = null;
    if (due) {
      daysUntilDue = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    }
    return { ...c, daysUntilDue };
  });

  // 篩選
  switch (appState.currentFilter) {
    case 'all':
      // 全部
      break;
    case '⏳ 流通中':
      result = result.filter(c => c.status === '⏳ 流通中');
      break;
    case 'pressed':
      result = result.filter(c => isPressedStatus(c.status));
      break;
    case '✅ 已入帳':
      result = result.filter(c => c.status === '✅ 已入帳');
      break;
    case '❌ 作廢':
      result = result.filter(c => c.status === '❌ 作廢');
      break;
    case '♻️收回流出':
      result = result.filter(c => c.status.includes('收回') || c.status.includes('♻️'));
      break;
    case 'urgent':
      result = result.filter(c =>
        c.status === '⏳ 流通中' &&
        c.daysUntilDue !== null &&
        c.daysUntilDue >= 0 &&
        c.daysUntilDue <= CONFIG.urgentDays
      );
      break;
    case 'overdue':
      result = result.filter(c =>
        c.status === '⏳ 流通中' &&
        c.daysUntilDue !== null &&
        c.daysUntilDue < 0
      );
      break;
  }

  // 搜尋
  if (appState.searchQuery) {
    const q = appState.searchQuery.toLowerCase();
    result = result.filter(c =>
      (c.payee || '').toLowerCase().includes(q) ||
      (c.checkNo || '').toLowerCase().includes(q) ||
      (c.holder || '').toLowerCase().includes(q) ||
      (c.notes || '').toLowerCase().includes(q) ||
      (c.user || '').toLowerCase().includes(q)
    );
  }

  // 排序
  switch (appState.currentSort) {
    case 'urgency':
      result.sort((a, b) => {
        const urgencyA = getUrgencyScore(a);
        const urgencyB = getUrgencyScore(b);
        if (urgencyA !== urgencyB) return urgencyB - urgencyA;
        // 同優先級按到期日升序
        const dA = a.daysUntilDue ?? 9999;
        const dB = b.daysUntilDue ?? 9999;
        return dA - dB;
      });
      break;
    case 'dueDate_asc':
      result.sort((a, b) => {
        const dA = parseDate(a.dueDate)?.getTime() ?? Infinity;
        const dB = parseDate(b.dueDate)?.getTime() ?? Infinity;
        return dA - dB;
      });
      break;
    case 'dueDate_desc':
      result.sort((a, b) => {
        const dA = parseDate(a.dueDate)?.getTime() ?? 0;
        const dB = parseDate(b.dueDate)?.getTime() ?? 0;
        return dB - dA;
      });
      break;
    case 'amount_desc':
      result.sort((a, b) => parseAmount(b.amount) - parseAmount(a.amount));
      break;
    case 'payee':
      result.sort((a, b) => (a.payee || '').localeCompare(b.payee || '', 'zh-TW'));
      break;
  }

  appState.filtered = result;
  renderCheckList();
}

function getUrgencyScore(check) {
  if (check.status !== '⏳ 流通中') return 0;
  const d = check.daysUntilDue;
  if (d === null) return 1;
  if (d < 0) return 8;        // 已過期
  if (d <= 7) return 7;       // 7天內 - 緊急
  if (d <= 30) return 5;      // 30天內 - 警告
  return 2;                    // 正常
}

// =====================================================================
// 渲染支票列表
// =====================================================================
function renderCheckList() {
  const list = document.getElementById('checkList');
  const count = document.getElementById('listCount');
  const checks = appState.filtered;

  count.textContent = `共 ${checks.length} 張支票`;

  if (checks.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">找不到符合的支票</div>
        <div class="empty-sub">試試調整篩選條件或搜尋關鍵字</div>
      </div>
    `;
    return;
  }

  list.innerHTML = checks.map((check, idx) => renderCheckCard(check, idx)).join('');

  // 綁定卡片點擊
  list.querySelectorAll('.check-card').forEach(card => {
    card.addEventListener('click', () => {
      const checkId = card.dataset.checkId;
      const check = findCheckById(checkId);
      if (check) openDetailModal(check);
      else recoverInvalidCheckSelection();
    });
  });
}

function renderCheckCard(check, idx) {
  const today = new Date(); today.setHours(0,0,0,0);
  const due = parseDate(check.dueDate);
  let daysUntilDue = null;
  if (due) daysUntilDue = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

  const statusClass = getStatusClass(check.status);
  const urgencyClass = getUrgencyClass(daysUntilDue, check.status);
  const statusBadge = getStatusBadge(check.status);
  const dueBadge = getDueBadge(daysUntilDue, check.status);
  const amountFormatted = formatAmount(check.amount);

  const animDelay = Math.min(idx * 30, 300);

  return `
    <div class="check-card ${statusClass} ${urgencyClass}"
         data-check-id="${getCheckId(check)}"
         style="animation-delay: ${animDelay}ms">
      <div class="card-header">
        <div class="card-main-info">
          <div class="card-payee">
            <span>${check.payee || '（無受款人）'}</span>
            ${check.status === '⏳ 流通中' ? dueBadge : statusBadge}
          </div>
          ${check.checkNo ? `<div class="card-check-no">🔑 ${check.checkNo}</div>` : ''}
        </div>
        <div>
          <div class="card-amount">${amountFormatted}</div>
          ${check.amountCN ? `<div class="card-amount-cn">${check.amountCN}</div>` : ''}
        </div>
      </div>
      <div class="card-details">
        <div class="card-detail-item">
          <span class="detail-label">到期日</span>
          <span class="detail-value">${formatDateDisplay(check.dueDate) || '—'}</span>
        </div>
        <div class="card-detail-item">
          <span class="detail-label">持票人</span>
          <span class="detail-value">${check.holder ? `<span class="holder-tag">👤 ${check.holder}</span>` : '—'}</span>
        </div>
        <div class="card-detail-item">
          <span class="detail-label">使用者</span>
          <span class="detail-value">${check.user || '—'}</span>
        </div>
        <div class="card-detail-item">
          <span class="detail-label">狀態</span>
          <span class="detail-value">${check.status !== '⏳ 流通中' ? statusBadge : (check.deferTo || '—')}</span>
        </div>
      </div>
      ${check.notes ? `<div class="card-notes">📝 ${check.notes}</div>` : ''}
    </div>
  `;
}

// =====================================================================
// 統計儀表板更新
// =====================================================================
function updateStats() {
  const today = new Date(); today.setHours(0,0,0,0);

  let urgent = 0, warning = 0, circulating = 0, overdue = 0;
  const amounts = calculateOutstandingAmounts(appState.checks);

  appState.checks.forEach(c => {
    if (c.status !== '⏳ 流通中') return;
    circulating++;

    const due = parseDate(c.dueDate);
    if (due) {
      const days = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
      if (days < 0) overdue++;
      else if (days <= CONFIG.urgentDays) urgent++;
      else if (days <= CONFIG.warnDays) warning++;
    }
  });

  document.getElementById('urgentCount').textContent = urgent;
  document.getElementById('warningCount').textContent = warning;
  document.getElementById('circulatingCount').textContent = circulating;
  document.getElementById('overdueCount').textContent = overdue;
  document.getElementById('outstandingAmount').textContent = formatSummaryAmount(amounts.outstanding);
  document.getElementById('pressedAmount').textContent = formatSummaryAmount(amounts.pressed);
  document.getElementById('circulatingAmount').textContent = formatSummaryAmount(amounts.circulating);
}

function calculateOutstandingAmounts(checks) {
  return checks.reduce((totals, check) => {
    const amount = parseAmount(check.amount);
    if (check.status === '⏳ 流通中') totals.circulating += amount;
    if (isPressedStatus(check.status)) totals.pressed += amount;
    totals.outstanding = totals.circulating + totals.pressed;
    return totals;
  }, { outstanding: 0, pressed: 0, circulating: 0 });
}

function formatSummaryAmount(amount) {
  return `NT$ ${amount.toLocaleString('zh-TW')}`;
}

// =====================================================================
// 到期警示
// =====================================================================
function checkExpiryAlerts() {
  const today = new Date(); today.setHours(0,0,0,0);
  const urgent = appState.checks.filter(c => {
    if (c.status !== '⏳ 流通中') return false;
    const due = parseDate(c.dueDate);
    if (!due) return false;
    const days = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= CONFIG.urgentDays;
  });

  const overdue = appState.checks.filter(c => {
    if (c.status !== '⏳ 流通中') return false;
    const due = parseDate(c.dueDate);
    if (!due) return false;
    const days = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    return days < 0;
  });

  const banner = document.getElementById('alertBanner');
  const alertText = document.getElementById('alertText');

  let messages = [];
  if (overdue.length > 0) {
    messages.push(`⚠️ 有 ${overdue.length} 張支票已過期，請立即處理！`);
  }
  if (urgent.length > 0) {
    const names = urgent.map(c => c.payee || '未知').slice(0, 3).join('、');
    messages.push(`🔴 ${urgent.length} 張支票將於 ${CONFIG.urgentDays} 天內到期（${names}${urgent.length > 3 ? '...' : ''}）`);
  }

  if (messages.length > 0) {
    alertText.innerHTML = messages.join('<br>');
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

// =====================================================================
// Modal 操作
// =====================================================================
function openModal(check = null) {
  const modal = document.getElementById('checkModal');
  const title = document.getElementById('modalTitle');
  const deleteBtn = document.getElementById('btnDeleteCheck');

  // 重置表單
  modal.querySelectorAll('input:not([type="hidden"]), textarea').forEach(field => { field.value = ''; });
  document.getElementById('editCheckId').value = '';
  appState.currentCheck = check;
  appState.pendingAttachments = [];
  document.getElementById('amountCNDisplay').textContent = '';
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-status="⏳ 流通中"]').classList.add('active');
  document.getElementById('formStatus').value = '⏳ 流通中';

  if (check) {
    // 編輯模式
    title.textContent = '編輯支票';
    deleteBtn.style.display = 'block';
    document.getElementById('editCheckId').value = getCheckId(check);

    // 填入資料
    document.getElementById('formStatus').value = check.status;
    document.querySelectorAll('.status-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.status === check.status);
    });
    document.getElementById('formCheckNo').value = check.checkNo || '';
    document.getElementById('formDueDate').value = convertToInputDate(check.dueDate);
    document.getElementById('formPayee').value = check.payee || '';
    document.getElementById('formAmount').value = parseAmount(check.amount) || '';
    document.getElementById('formAmountCN').value = check.amountCN || '';
    document.getElementById('formUser').value = check.user || '';
    document.getElementById('formHolder').value = check.holder || '';
    document.getElementById('formIssueDate').value = convertToInputDate(check.issueDate);
    document.getElementById('formCashDate').value = convertToInputDate(check.cashDate);
    document.getElementById('formDeferTo').value = check.deferTo || '';
    document.getElementById('formNotes').value = check.notes || '';

    if (check.amount) {
      const amt = parseAmount(check.amount);
      document.getElementById('amountCNDisplay').textContent = check.amountCN || numberToChinese(amt);
    }
  } else {
    // 新增模式
    title.textContent = '新增支票';
    deleteBtn.style.display = 'none';
    document.getElementById('formCheckNo').value = 'NO. ';
    // 預設今天開票
    document.getElementById('formIssueDate').value = getTodayISO();
  }

  updatePayeeDatalist();
  renderAttachmentEditor(check);
  openOverlay('checkModal');
}

function closeModal() {
  closeOverlay('checkModal');
}

// =====================================================================
// 儲存支票
// =====================================================================
async function saveCheck() {
  const apiUrl = CONFIG.apiUrl;
  if (!apiUrl) {
    showToast('❌ 請先在設定中填入 API 網址', 'error');
    return;
  }

  const checkId = document.getElementById('editCheckId').value;
  const status = document.getElementById('formStatus').value;
  const dueDate = document.getElementById('formDueDate').value;

  if (!status || !dueDate) {
    showToast('❌ 請填寫必填欄位（狀態、到期日）', 'error');
    return;
  }

  const amountRaw = document.getElementById('formAmount').value;
  const amount = amountRaw ? `NT$${parseFloat(amountRaw).toLocaleString('zh-TW', {minimumFractionDigits: 2})}` : '';

  const checkData = {
    status,
    checkNo: normalizeCheckNumber(document.getElementById('formCheckNo').value),
    dueDate: formatDateForSheet(dueDate),
    payee: document.getElementById('formPayee').value,
    amount,
    amountCN: document.getElementById('formAmountCN').value || (amountRaw ? numberToChinese(parseFloat(amountRaw)) : ''),
    user: document.getElementById('formUser').value,
    holder: document.getElementById('formHolder').value,
    issueDate: formatDateForSheet(document.getElementById('formIssueDate').value),
    cashDate: formatDateForSheet(document.getElementById('formCashDate').value),
    deferTo: document.getElementById('formDeferTo').value,
    notes: document.getElementById('formNotes').value
  };

  const btn = document.getElementById('btnSaveCheck');
  btn.disabled = true;
  btn.textContent = '儲存中...';

  try {
    const body = checkId
      ? { action: 'update', data: { ...checkData, id: checkId } }
      : { action: 'add', data: checkData };

    const response = await fetch(apiUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain' }, // Apps Script 需要
      body: JSON.stringify(body)
    });

    const result = await response.json();
    if (result.success) {
      const savedCheckId = result.checkId || checkId;
      let uploadResult = { uploaded: 0, failed: 0 };
      if (savedCheckId && appState.pendingAttachments.length) {
        btn.textContent = '照片上傳中...';
        uploadResult = await uploadPendingAttachments(savedCheckId, appState.pendingAttachments);
      }
      closeModal();
      showToast(
        `✅ ${checkId ? '支票已更新' : '支票已新增'}${uploadResult.uploaded ? `，已上傳 ${uploadResult.uploaded} 個附件` : ''}${uploadResult.failed ? `；${uploadResult.failed} 個附件失敗` : ''}`,
        uploadResult.failed ? 'warning' : 'success',
        uploadResult.failed ? 6000 : 3000
      );
      clearCache();
      await loadChecks(true);
    } else {
      throw new Error(result.error || '操作失敗');
    }
  } catch (err) {
    showToast(`❌ 儲存失敗: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 儲存';
  }
}

// =====================================================================
// 刪除支票
// =====================================================================
async function deleteCheck(checkId) {
  const apiUrl = CONFIG.apiUrl;
  if (!apiUrl) {
    showToast('❌ 請先設定 API 網址', 'error');
    return;
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'delete', data: { id: checkId } })
    });
    const result = await response.json();
    if (result.success) {
      closeModal();
      showToast('🗑 支票已刪除', 'success');
      clearCache();
      await loadChecks(true);
    } else {
      throw new Error(result.error || '刪除失敗');
    }
  } catch (err) {
    showToast(`❌ 刪除失敗: ${err.message}`, 'error');
  }
}

// =====================================================================
// 支票照片／掃描附件
// =====================================================================
function renderAttachmentEditor(check) {
  const persisted = (check && check.attachments) || [];
  const pending = appState.pendingAttachments;
  const list = document.getElementById('attachmentList');
  const hint = document.getElementById('attachmentHint');
  const total = persisted.length + pending.length;

  list.innerHTML = attachmentItemsHtml(persisted, true) + pendingAttachmentItemsHtml(pending);
  hint.textContent = total
    ? `目前 ${total}/3 個附件${pending.length ? `；${pending.length} 個會在儲存後上傳` : ''}`
    : '新增時可先選照片，儲存支票後會自動上傳。';
  document.getElementById('cameraButton').disabled = total >= 3;
  document.getElementById('cameraInput').disabled = total >= 3;
  document.getElementById('attachmentInput').disabled = total >= 3;
  bindAttachmentButtons(list, check, true);
  bindPendingAttachmentButtons(list);
}

function attachmentItemsHtml(attachments, editable) {
  if (!attachments.length) return '';
  return attachments.map(item => {
    const kind = item.mimeType === 'application/pdf' ? '📄 PDF' : '🖼️ 照片';
    return `<div class="attachment-item" data-file-id="${escapeHtml(item.fileId)}">
      <span>${kind}</span><span class="attachment-name">${escapeHtml(item.name || '支票附件')}</span>
      <button type="button" data-action="preview">查看</button>
      ${editable ? '<button class="remove" type="button" data-action="remove">移除</button>' : ''}
    </div>`;
  }).join('');
}

function pendingAttachmentItemsHtml(attachments) {
  if (!attachments.length && !((appState.currentCheck && appState.currentCheck.attachments) || []).length) {
    return '<div class="attachment-empty">尚未選擇照片或掃描檔</div>';
  }
  return attachments.map((item, index) => {
    const kind = item.mimeType === 'application/pdf' ? '📄 PDF' : '🖼️ 照片';
    return `<div class="attachment-item" data-pending-index="${index}">
      <span>${kind}</span><span class="attachment-name">${escapeHtml(item.name)}</span>
      <span class="attachment-pending">待儲存</span>
      <button type="button" data-action="preview-pending">查看</button>
      <button class="remove" type="button" data-action="remove-pending">移除</button>
    </div>`;
  }).join('');
}

function bindAttachmentButtons(container, check, editable) {
  if (!container || !check) return;
  const checkId = getCheckId(check);
  container.querySelectorAll('[data-action="preview"]').forEach(button => {
    button.addEventListener('click', () => previewAttachment(checkId, button.closest('[data-file-id]').dataset.fileId));
  });
  if (!editable) return;
  container.querySelectorAll('[data-action="remove"]').forEach(button => {
    button.addEventListener('click', () => removeAttachment(checkId, button.closest('[data-file-id]').dataset.fileId));
  });
}

function bindPendingAttachmentButtons(container) {
  container.querySelectorAll('[data-action="preview-pending"]').forEach(button => {
    button.addEventListener('click', () => previewPendingAttachment(Number(button.closest('[data-pending-index]').dataset.pendingIndex)));
  });
  container.querySelectorAll('[data-action="remove-pending"]').forEach(button => {
    button.addEventListener('click', () => {
      appState.pendingAttachments.splice(Number(button.closest('[data-pending-index]').dataset.pendingIndex), 1);
      renderAttachmentEditor(appState.currentCheck);
    });
  });
}

async function uploadSelectedAttachment(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const persistedCount = ((appState.currentCheck && appState.currentCheck.attachments) || []).length;
    if (persistedCount + appState.pendingAttachments.length >= 3) throw new Error('每張支票最多 3 個附件');
    showToast('正在處理附件…', 'info', 5000);
    appState.pendingAttachments.push(await prepareAttachment(file));
    renderAttachmentEditor(appState.currentCheck);
    showToast('照片已選擇，儲存支票後會自動上傳', 'success');
  } catch (error) {
    showToast(`❌ 附件處理失敗：${error.message}`, 'error', 6000);
  } finally {
    event.target.value = '';
  }
}

async function uploadPendingAttachments(checkId, attachments) {
  let uploaded = 0;
  let failed = 0;
  for (const attachment of attachments) {
    try {
      await apiPost('uploadAttachment', { checkId, attachment });
      uploaded++;
    } catch (error) {
      console.error('附件上傳失敗:', error);
      failed++;
    }
  }
  return { uploaded, failed };
}

async function prepareAttachment(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 6 * 1024 * 1024) throw new Error('PDF 必須小於 6 MB');
    return { name: file.name, mimeType: file.type, base64: await readFileAsBase64(file) };
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('只允許 JPG、PNG、WebP 或 PDF');
  return compressImage(file, 1600, 0.82);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}

function compressImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取照片失敗'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('照片格式無法讀取'));
      image.onload = () => {
        const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1] || '';
        if (Math.ceil(base64.length * 0.75) > 6 * 1024 * 1024) return reject(new Error('壓縮後照片仍超過 6 MB'));
        resolve({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg', base64 });
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function previewPendingAttachment(index) {
  const attachment = appState.pendingAttachments[index];
  if (!attachment) return;
  showAttachmentPreview(attachment.name, attachment.mimeType, `data:${attachment.mimeType};base64,${attachment.base64}`);
}

async function previewAttachment(checkId, fileId) {
  document.getElementById('attachmentTitle').textContent = '讀取附件中…';
  document.getElementById('attachmentPreview').innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  openOverlay('attachmentModal');
  try {
    const result = await apiPost('getAttachment', { checkId, fileId });
    showAttachmentPreview(result.name, result.mimeType, result.dataUrl);
  } catch (error) {
    document.getElementById('attachmentPreview').innerHTML = `<div class="attachment-empty">附件讀取失敗：${escapeHtml(error.message)}</div>`;
  }
}

function showAttachmentPreview(name, mimeType, dataUrl) {
  document.getElementById('attachmentTitle').textContent = name || '支票附件';
  document.getElementById('attachmentPreview').innerHTML = mimeType === 'application/pdf'
    ? `<iframe title="PDF 掃描" src="${dataUrl}"></iframe>`
    : `<img alt="支票照片" src="${dataUrl}">`;
  openOverlay('attachmentModal');
}

function closeAttachmentPreview() {
  closeOverlay('attachmentModal');
  document.getElementById('attachmentPreview').innerHTML = '';
}

async function removeAttachment(checkId, fileId) {
  if (!checkId || !confirm('確定要移除這個附件嗎？移除後會放入 Google Drive 垃圾桶。')) return;
  try {
    const result = await apiPost('removeAttachment', { checkId, fileId });
    if (appState.currentCheck) appState.currentCheck.attachments = result.attachments || [];
    renderAttachmentEditor(appState.currentCheck);
    clearCache();
    await loadChecks(true);
    showToast('附件已移到 Drive 垃圾桶', 'success');
  } catch (error) {
    showToast(`❌ 移除失敗：${error.message}`, 'error', 6000);
  }
}

async function apiPost(action, data) {
  const response = await fetch(CONFIG.apiUrl, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, data })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (!result.success) throw new Error(result.error || '操作失敗');
  return result;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

// =====================================================================
// 詳情 Modal
// =====================================================================
function openDetailModal(check) {
  const body = document.getElementById('detailBody');
  const today = new Date(); today.setHours(0,0,0,0);
  const due = parseDate(check.dueDate);
  let daysUntilDue = null;
  if (due) daysUntilDue = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

  const statusBadge = getStatusBadge(check.status);
  const dueBadge = getDueBadge(daysUntilDue, check.status);

  body.innerHTML = `
    <div style="margin-bottom:16px; display:flex; align-items:center; justify-content:space-between;">
      ${statusBadge}
      ${check.status === '⏳ 流通中' ? dueBadge : ''}
    </div>
    <div style="font-size:26px;font-weight:700;color:#fbbf24;margin-bottom:4px;">${formatAmount(check.amount)}</div>
    <div style="font-size:14px;color:#94a3b8;margin-bottom:20px;">${check.amountCN || ''}</div>
    <div class="detail-grid">
      <div class="detail-item full-width">
        <div class="detail-label">受款人</div>
        <div class="detail-value" style="font-size:18px;font-weight:600;">${check.payee || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">支票號碼</div>
        <div class="detail-value">${check.checkNo || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">使用者</div>
        <div class="detail-value">${check.user || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">到期日</div>
        <div class="detail-value" style="font-weight:600;">${formatDateDisplay(check.dueDate) || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">開票日期</div>
        <div class="detail-value">${formatDateDisplay(check.issueDate) || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">目前持票人</div>
        <div class="detail-value">${check.holder ? `<span class="holder-tag">👤 ${check.holder}</span>` : '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">兌現日期</div>
        <div class="detail-value">${formatDateDisplay(check.cashDate) || '—'}</div>
      </div>
      ${check.deferTo ? `
      <div class="detail-item full-width">
        <div class="detail-label">延後至 / 押票</div>
        <div class="detail-value" style="color:#fdba74;">${check.deferTo}</div>
      </div>` : ''}
      ${check.recalled ? `
      <div class="detail-item full-width">
        <div class="detail-label">已抽回</div>
        <div class="detail-value" style="color:#f87171;">${check.recalled}</div>
      </div>` : ''}
      ${check.notes ? `
      <div class="detail-item full-width">
        <div class="detail-label">備註</div>
        <div class="detail-value">${check.notes}</div>
      </div>` : ''}
      <div class="detail-item full-width">
        <div class="detail-label">支票照片／掃描</div>
        <div id="detailAttachmentList">${attachmentItemsHtml(check.attachments || [], false)}</div>
      </div>
    </div>
  `;

  document.getElementById('btnDetailEdit').dataset.checkId = getCheckId(check);
  bindAttachmentButtons(document.getElementById('detailAttachmentList'), check, false);
  openOverlay('detailModal');
}

function closeDetailModal() {
  closeOverlay('detailModal');
}

// =====================================================================
// 頁面導航
// =====================================================================
function handleNavigation(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

  switch (page) {
    case 'home':
      // 已在主頁
      break;
    case 'stats':
      openStatsPage();
      break;
    case 'expiring':
      openExpiringPage();
      break;
    case 'settings':
      openSettingsPage();
      break;
  }
}

function openStatsPage() {
  const content = document.getElementById('statsContent');
  const today = new Date(); today.setHours(0,0,0,0);

  // 統計持票人
  const holderMap = {};
  let totalCirculating = 0;
  appState.checks.forEach(c => {
    if (c.status !== '⏳ 流通中') return;
    const holder = c.holder || '（未指定）';
    const amt = parseAmount(c.amount);
    if (!holderMap[holder]) holderMap[holder] = { count: 0, amount: 0 };
    holderMap[holder].count++;
    holderMap[holder].amount += amt;
    totalCirculating += amt;
  });

  const sortedHolders = Object.entries(holderMap).sort((a,b) => b[1].amount - a[1].amount);
  const maxAmt = sortedHolders[0]?.[1].amount || 1;

  // 狀態統計
  const statusCount = {};
  appState.checks.forEach(c => {
    statusCount[c.status] = (statusCount[c.status] || 0) + 1;
  });

  content.innerHTML = `
    <div class="stats-section">
      <h3>💰 流通中金額統計</h3>
      <div class="total-amount" style="margin-bottom:16px;">
        <span class="amount-label">流通中總金額</span>
        <span class="amount-value">NT$ ${totalCirculating.toLocaleString('zh-TW')}</span>
      </div>
    </div>
    <div class="stats-section">
      <h3>👤 持票人分析</h3>
      <div class="holder-list">
        ${sortedHolders.length > 0 ? sortedHolders.map(([name, info]) => `
          <div class="holder-item">
            <div>
              <div class="holder-name">${name}</div>
              <div class="amount-bar-container">
                <div class="amount-bar" style="width:${(info.amount/maxAmt*100).toFixed(1)}%"></div>
              </div>
            </div>
            <div class="holder-info">
              <div class="holder-amount">NT$ ${info.amount.toLocaleString('zh-TW')}</div>
              <div class="holder-count">${info.count} 張</div>
            </div>
          </div>
        `).join('') : '<div class="expiring-empty">目前無流通中支票</div>'}
      </div>
    </div>
    <div class="stats-section">
      <h3>📋 狀態分佈</h3>
      <div class="holder-list">
        ${Object.entries(statusCount).map(([status, count]) => `
          <div class="holder-item">
            <span class="holder-name">${displayStatus(status)}</span>
            <div class="holder-info">
              <span class="holder-amount" style="font-size:18px;">${count}</span>
              <span class="holder-count">張</span>
            </div>
          </div>
        `).join('')}
        <div class="holder-item">
          <span class="holder-name" style="font-weight:700;">合計</span>
          <div class="holder-info">
            <span class="holder-amount" style="font-size:18px;">${appState.checks.length}</span>
            <span class="holder-count">張</span>
          </div>
        </div>
      </div>
    </div>
  `;

  openOverlay('statsPage');
}

function openExpiringPage() {
  const content = document.getElementById('expiringContent');
  const today = new Date(); today.setHours(0,0,0,0);

  const circulating = appState.checks.filter(c => c.status === '⏳ 流通中');
  const categorized = {
    overdue: [],
    critical: [],
    urgent: [],
    warning: [],
    ok: []
  };

  circulating.forEach(c => {
    const due = parseDate(c.dueDate);
    if (!due) { categorized.ok.push({...c, daysUntilDue: null}); return; }
    const days = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    const item = {...c, daysUntilDue: days};
    if (days < 0) categorized.overdue.push(item);
    else if (days <= 3) categorized.critical.push(item);
    else if (days <= CONFIG.urgentDays) categorized.urgent.push(item);
    else if (days <= CONFIG.warnDays) categorized.warning.push(item);
    else categorized.ok.push(item);
  });

  function renderSection(title, items, badgeClass) {
    if (items.length === 0) return '';
    return `
      <div class="expiring-section">
        <h3>${title}</h3>
        <div class="check-list">
          ${items.map((c, i) => renderCheckCard(c, i)).join('')}
        </div>
      </div>
    `;
  }

  content.innerHTML =
    renderSection('⛔ 已過期（請立即處理！）', categorized.overdue, 'due-overdue') +
    renderSection('🔴 3天內到期', categorized.critical, 'due-critical') +
    renderSection(`🟠 ${CONFIG.urgentDays}天內到期`, categorized.urgent, 'due-urgent') +
    renderSection(`🟡 ${CONFIG.warnDays}天內到期`, categorized.warning, 'due-warning') +
    renderSection('✅ 尚早（30天以上）', categorized.ok, 'due-ok') ||
    '<div class="expiring-empty">🎉 目前沒有到期提醒</div>';

  // 綁定點擊
  setTimeout(() => {
    content.querySelectorAll('.check-card').forEach(card => {
      card.addEventListener('click', () => {
        const checkId = card.dataset.checkId;
        const check = findCheckById(checkId);
        if (check) { closeOverlay('expiringPage'); openDetailModal(check); }
        else recoverInvalidCheckSelection();
      });
    });
  }, 100);

  openOverlay('expiringPage');
}

function openSettingsPage() {
  document.getElementById('settingApiUrl').value = CONFIG.apiUrl;
  document.getElementById('settingUrgentDays').value = CONFIG.urgentDays;
  document.getElementById('settingWarnDays').value = CONFIG.warnDays;
  updateCacheInfo();
  openOverlay('settingsPage');
}

function closePage(id) {
  closeOverlay(id);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('[data-page="home"]')?.classList.add('active');
}

// =====================================================================
// 設定
// =====================================================================
function loadSettings() {
  document.getElementById('settingApiUrl').value = CONFIG.apiUrl;
  document.getElementById('settingUrgentDays').value = CONFIG.urgentDays;
  document.getElementById('settingWarnDays').value = CONFIG.warnDays;
}

function saveSettings() {
  const url = document.getElementById('settingApiUrl').value.trim();
  if (!url) {
    showToast('❌ 請填入 Apps Script 網址', 'error');
    return;
  }
  localStorage.setItem(CONFIG.API_URL_KEY, url);
  saveAlertSettings();
  showToast('✅ 設定已儲存，重新載入資料...', 'success');
  closeOverlay('settingsPage');
  clearCache();
  loadChecks(true);
}

function saveAlertSettings() {
  const urgent = document.getElementById('settingUrgentDays').value;
  const warn = document.getElementById('settingWarnDays').value;
  localStorage.setItem(CONFIG.URGENT_DAYS_KEY, urgent);
  localStorage.setItem(CONFIG.WARN_DAYS_KEY, warn);
  showToast('✅ 警示設定已儲存', 'success');
  applyFiltersAndSort();
  updateStats();
  checkExpiryAlerts();
}

// =====================================================================
// 快取管理
// =====================================================================
function getCachedData() {
  try {
    const time = localStorage.getItem(CONFIG.CACHE_TIME_KEY);
    if (!time) return null;
    if (Date.now() - parseInt(time) > CONFIG.CACHE_TTL) return null;
    const data = localStorage.getItem(CONFIG.CACHE_KEY);
    const parsed = data ? JSON.parse(data) : null;
    if (parsed && !hasValidUniqueCheckIds(parsed)) {
      localStorage.removeItem(CONFIG.CACHE_KEY);
      localStorage.removeItem(CONFIG.CACHE_TIME_KEY);
      return null;
    }
    return parsed;
  } catch (e) { return null; }
}

function setCachedData(data) {
  try {
    localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CONFIG.CACHE_TIME_KEY, Date.now().toString());
  } catch (e) { console.warn('快取失敗:', e); }
}

function clearCache() {
  localStorage.removeItem(CONFIG.CACHE_KEY);
  localStorage.removeItem(CONFIG.CACHE_TIME_KEY);
  updateCacheInfo();
}

function updateCacheInfo() {
  const time = localStorage.getItem(CONFIG.CACHE_TIME_KEY);
  const info = document.getElementById('cacheInfo');
  if (info) {
    if (time) {
      const d = new Date(parseInt(time));
      info.textContent = `快取時間：${d.toLocaleString('zh-TW')}`;
    } else {
      info.textContent = '目前無快取資料';
    }
  }
}

// =====================================================================
// Overlay 開關
// =====================================================================
function openOverlay(id) {
  const el = document.getElementById(id);
  el.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeOverlay(id) {
  const el = document.getElementById(id);
  el.classList.remove('active');
  document.body.style.overflow = '';
}

// =====================================================================
// 其他 UI 輔助
// =====================================================================
function setLoading(show) {
  appState.isLoading = show;
  if (show) {
    document.getElementById('checkList').innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>載入支票資料中...</p>
      </div>
    `;
  }
}

function showEmptyState(title, sub) {
  document.getElementById('checkList').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">${title}</div>
      <div class="empty-sub">${sub}</div>
    </div>
  `;
}

function showToast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration + 300);
}

function setFilter(filter) {
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  appState.currentFilter = filter;
  applyFiltersAndSort();
  // 滾動到頂部
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updatePayeeDatalist() {
  const payees = [...new Set(appState.checks.map(c => c.payee).filter(Boolean))];
  const holders = [...new Set(appState.checks.map(c => c.holder).filter(Boolean))];
  document.getElementById('payeeList').innerHTML = payees.map(p => `<option value="${p}">`).join('');
  document.getElementById('holderList').innerHTML = holders.map(h => `<option value="${h}">`).join('');
}

function getCheckId(check) {
  return String((check && (check.id || check.checkId)) || '');
}

function hasValidUniqueCheckIds(checks) {
  if (!Array.isArray(checks)) return false;
  const ids = checks.map(getCheckId);
  return ids.every(Boolean) && new Set(ids).size === ids.length;
}

function findCheckById(checkId) {
  if (!checkId) return null;
  const matches = appState.checks.filter(check => getCheckId(check) === String(checkId));
  return matches.length === 1 ? matches[0] : null;
}

function recoverInvalidCheckSelection() {
  showToast('⚠️ 支票識別資料已過期，正在重新載入正式資料', 'warning', 5000);
  closeDetailModal();
  clearCache();
  loadChecks(true);
}

// =====================================================================
// 徽章 / 樣式輔助
// =====================================================================
function getStatusClass(status) {
  if (status === '⏳ 流通中') return 'status-circulating';
  if (isPressedStatus(status)) return 'status-pressed';
  if (status === '✅ 已入帳' || status.includes('已入帳')) return 'status-done';
  if (status === '❌ 作廢') return 'status-void';
  if (status.includes('收回') || status.includes('♻️')) return 'status-recall';
  return 'status-done';
}

function getUrgencyClass(days, status) {
  if (status !== '⏳ 流通中') return '';
  if (days === null) return '';
  if (days < 0) return 'urgency-critical';
  if (days <= 7) return 'urgency-critical';
  if (days <= 30) return 'urgency-urgent';
  return '';
}

function getStatusBadge(status) {
  if (status === '⏳ 流通中') return `<span class="status-badge badge-circulating">${status}</span>`;
  if (isPressedStatus(status)) return `<span class="status-badge badge-pressed">${displayStatus(status)}</span>`;
  if (status === '✅ 已入帳' || status.includes('已入帳')) return `<span class="status-badge badge-done">${status}</span>`;
  if (status === '❌ 作廢') return `<span class="status-badge badge-void">${status}</span>`;
  if (status.includes('收回') || status.includes('♻️')) return `<span class="status-badge badge-recall">${status}</span>`;
  return `<span class="status-badge badge-done">${status}</span>`;
}

function isPressedStatus(status) {
  return status === '📌 壓票中' || status === '📌 押票中';
}

function displayStatus(status) {
  return isPressedStatus(status) ? '📌 押票中' : status;
}

function getDueBadge(days, status) {
  if (status !== '⏳ 流通中' || days === null) return '';
  if (days < 0) return `<span class="due-badge due-overdue">🔴 已過期 ${Math.abs(days)} 天</span>`;
  if (days === 0) return `<span class="due-badge due-critical">🔴 今天到期！</span>`;
  if (days <= 3) return `<span class="due-badge due-critical">🔴 ${days} 天後到期</span>`;
  if (days <= 7) return `<span class="due-badge due-urgent">🟠 ${days} 天後到期</span>`;
  if (days <= 30) return `<span class="due-badge due-warning">🟡 ${days} 天後到期</span>`;
  return `<span class="due-badge due-ok">✅ ${days} 天後到期</span>`;
}

// =====================================================================
// 日期輔助
// =====================================================================
function parseDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();

  // 西元: 2024/06/04 或 2024-06-04
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));

  // 民國: 114/07/15（2~3位年份）
  m = s.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (m && parseInt(m[1]) < 200) {
    return new Date(parseInt(m[1]) + 1911, parseInt(m[2]) - 1, parseInt(m[3]));
  }

  return null;
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  if (s === '---' || s.includes('未開') || !s) return s;

  const d = parseDate(s);
  if (!d) return s; // 無法解析，原樣顯示

  const year = d.getFullYear();
  const rocYear = year - 1911;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${rocYear}/${String(m).padStart(2,'0')}/${String(day).padStart(2,'0')}（${year}）`;
}

function convertToInputDate(dateStr) {
  if (!dateStr) return '';
  const d = parseDate(dateStr);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateForSheet(inputDate) {
  if (!inputDate) return '';
  // 輸入格式 YYYY-MM-DD，輸出民國年月日
  const [y, m, d] = inputDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const roc = y - 1911;
  return `${roc}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
}

function getTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// =====================================================================
// 金額輔助
// =====================================================================
function parseAmount(amtStr) {
  if (!amtStr) return 0;
  const s = String(amtStr).replace(/[NT$,，\s]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function normalizeCheckNumber(value) {
  const checkNumber = String(value || '').trim();
  return /^NO\.?$/i.test(checkNumber) ? '' : checkNumber;
}

function formatAmount(amtStr) {
  if (!amtStr) return '—';
  const n = parseAmount(amtStr);
  if (n === 0) return amtStr; // 原樣
  return `NT$ ${n.toLocaleString('zh-TW')}`;
}

// =====================================================================
// 數字轉中文大寫
// =====================================================================
function numberToChinese(num) {
  if (!num) return '';
  const n = parseFloat(String(num).replace(/[^\d.]/g, ''));
  if (isNaN(n) || n === 0) return '';

  const digits = ['零', '壹', '貳', '叁', '肆', '伍', '陸', '柒', '捌', '玖'];
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '萬', '億'];

  const intPart = Math.floor(n);
  if (intPart === 0) return '零元整';

  const str = String(intPart);
  const len = str.length;
  let result = '';

  for (let i = 0; i < len; i++) {
    const d = parseInt(str[i]);
    const unitPos = (len - 1 - i) % 4;
    const bigUnitPos = Math.floor((len - 1 - i) / 4);

    if (d !== 0) {
      result += digits[d] + units[unitPos];
    } else {
      if (result && result[result.length - 1] !== '零') result += '零';
    }

    if (unitPos === 0 && bigUnitPos > 0) {
      result = result.replace(/零$/, '') + bigUnits[bigUnitPos];
    }
  }

  result = result.replace(/零+$/, '');
  return result + '元整';
}
