/**
 * Items To Be Received Dashboard Module
 * Displays receipt items with filtering, sorting, and click-through
 */

const ReportRCV = (function() {
    'use strict';

    // Private variables
    let containerId = '';
    let allData = [];
    let filteredData = [];
    let sortColumn = 'ordernum';
    let sortDirection = 'asc';

    /**
     * Initialize the Receipts tile
     * @param {string} container - ID of the container element
     */
    function init(container) {
        containerId = container;
        DashboardCommon.debugLog('Initializing Receipts module', 'info', 'RCV');
        setupUI();
        loadData();
    }

    /**
     * Setup the UI structure
     */
    function setupUI() {
        const container = document.getElementById(containerId);
        if (!container) {
            DashboardCommon.debugLog('Container not found: ' + containerId, 'error', 'RCV');
            return;
        }

        container.innerHTML = `
            <div class="tile-header">
                <div>
                    <h2 class="tile-title">Items To Be Received</h2>
                </div>
                <div class="tile-controls">
                    <span id="${containerId}-filterInfo" class="filter-info" style="display: none;"></span>
                    <button class="btn" onclick="ReportRCV.clearFilters()">Clear Filters</button>
                    <button class="btn btn-primary" onclick="ReportRCV.refresh()">Refresh</button>
                </div>
            </div>
            <div class="tile-table-container">
                <table class="tile-table">
                    <thead>
                        <tr>
                            <th data-column="scheduleindicator" class="schedule-col" onclick="ReportRCV.sortTable('datescheduled')" title="Schedule Status">
                                <svg class="clock-icon" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z"/>
                                </svg>
                            </th>
                            <th data-column="type" onclick="ReportRCV.sortTable('type')">Type <span class="sort-icon">⇅</span></th>
                            <th data-column="statusname" onclick="ReportRCV.sortTable('statusname')">Status <span class="sort-icon">⇅</span></th>
                            <th data-column="ordernum" onclick="ReportRCV.sortTable('ordernum')">Order # <span class="sort-icon">⇅</span></th>
                            <th data-column="datescheduled" onclick="ReportRCV.sortTable('datescheduled')">Scheduled Date <span class="sort-icon">⇅</span></th>
                            <th data-column="vendorname" onclick="ReportRCV.sortTable('vendorname')">Vendor <span class="sort-icon">⇅</span></th>
                        </tr>
                        <tr class="filter-row">
                            <td data-filter="scheduleindicator"></td>
                            <td><input type="text" data-filter="type" placeholder="Filter..." onkeyup="ReportRCV.applyFilters()"></td>
                            <td><input type="text" data-filter="statusname" placeholder="Filter..." onkeyup="ReportRCV.applyFilters()"></td>
                            <td><input type="text" data-filter="ordernum" placeholder="Filter..." onkeyup="ReportRCV.applyFilters()"></td>
                            <td><input type="text" data-filter="datescheduled" placeholder="Filter..." onkeyup="ReportRCV.applyFilters()"></td>
                            <td><input type="text" data-filter="vendorname" placeholder="Filter..." onkeyup="ReportRCV.applyFilters()"></td>
                        </tr>
                    </thead>
                    <tbody id="${containerId}-tableBody">
                        <tr>
                            <td colspan="6" style="text-align: center; padding: 20px; color: #94a3b8;">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    /**
     * Load receipts data
     */
    function loadData() {
        DashboardCommon.debugLog('Starting data load...', 'info', 'RCV');

        try {
            const currentUser = JSON.parse(getUser());
            const userId = currentUser.id;
            DashboardCommon.debugLog('Current user ID: ' + userId, 'info', 'RCV');

            const query =
                "SELECT " +
                "    Receipt.Id AS id, " +
                "    Receipt.OrderTypeId AS orderTypeId, " +
                "    Receipt.PoId AS poId, " +
                "    Receipt.SoId AS soId, " +
                "    Receipt.XoId AS xoId, " +
                "    ReceiptStatus.Name AS statusName, " +
                "    CASE " +
                "        WHEN Receipt.OrderTypeId = 10 THEN 'PO' " +
                "        WHEN Receipt.OrderTypeId = 20 THEN 'SO' " +
                "        WHEN Receipt.OrderTypeId = 40 THEN 'TO' " +
                "        ELSE 'Other' " +
                "    END AS type, " +
                "    CASE " +
                "        WHEN Receipt.OrderTypeId = 10 THEN (SELECT Num FROM Po WHERE Id = Receipt.PoId) " +
                "        WHEN Receipt.OrderTypeId = 20 THEN (SELECT Num FROM So WHERE Id = Receipt.SoId) " +
                "        WHEN Receipt.OrderTypeId = 40 THEN (SELECT Num FROM Xo WHERE Id = Receipt.XoId) " +
                "        ELSE NULL " +
                "    END AS orderNum, " +
                "    CASE " +
                "        WHEN Receipt.OrderTypeId = 10 THEN (SELECT Vendor.Name FROM Po LEFT JOIN Vendor ON Po.VendorId = Vendor.Id WHERE Po.Id = Receipt.PoId) " +
                "        ELSE NULL " +
                "    END AS vendorName, " +
                "    CASE " +
                "        WHEN Receipt.OrderTypeId = 10 THEN (SELECT DateFirstShip FROM Po WHERE Id = Receipt.PoId) " +
                "        WHEN Receipt.OrderTypeId = 20 THEN (SELECT DateFirstShip FROM So WHERE Id = Receipt.SoId) " +
                "        WHEN Receipt.OrderTypeId = 40 THEN (SELECT DateScheduled FROM Xo WHERE Id = Receipt.XoId) " +
                "        ELSE NULL " +
                "    END AS dateScheduled " +
                "FROM Receipt " +
                "LEFT JOIN ReceiptStatus ON Receipt.StatusId = ReceiptStatus.Id " +
                "INNER JOIN UserToLG ON Receipt.LocationGroupId = UserToLG.LocationGroupId AND UserToLG.UserId = " + userId + " " +
                "WHERE ReceiptStatus.Name IN ('Entered', 'Reconciled', 'Received') " +
                "ORDER BY Receipt.Id DESC";

            DashboardCommon.debugLog('Executing SQL query...', 'query', 'RCV');

            const queryResult = runQuery(query);
            const result = JSON.parse(queryResult);

            DashboardCommon.debugLog('Parsed ' + result.length + ' records', 'success', 'RCV');

            allData = result;
            applyFilters();

            DashboardCommon.debugLog('Load complete: ' + filteredData.length + ' receipts displayed', 'success', 'RCV');

        } catch (error) {
            DashboardCommon.debugLog('ERROR: ' + error.message, 'error', 'RCV');
            console.error('Error loading receipts:', error);
        }
    }

    /**
     * Apply filters to data
     */
    function applyFilters() {
        filteredData = allData.filter(function(row) {
            const container = document.getElementById(containerId);
            const filterInputs = container.querySelectorAll('.filter-row input[data-filter]');
            for (let i = 0; i < filterInputs.length; i++) {
                const input = filterInputs[i];
                if (input.value) {
                    const filterKey = input.getAttribute('data-filter');
                    const cellValue = (row[filterKey] || '').toString().toLowerCase();
                    const filterValue = input.value.toLowerCase();
                    if (cellValue.indexOf(filterValue) === -1) {
                        return false;
                    }
                }
            }
            return true;
        });

        updateFilterInfo();
        sortAndRender();
    }

    /**
     * Update filter info display
     */
    function updateFilterInfo() {
        const filterInfo = document.getElementById(containerId + '-filterInfo');
        if (!filterInfo) return;

        if (allData.length !== filteredData.length) {
            filterInfo.textContent = 'Showing ' + filteredData.length + ' of ' + allData.length + ' receipts';
            filterInfo.style.display = 'inline-block';
        } else {
            filterInfo.style.display = 'none';
        }
    }

    /**
     * Clear all filters
     */
    function clearFilters() {
        const container = document.getElementById(containerId);
        const inputs = container.querySelectorAll('.filter-row input');
        for (let i = 0; i < inputs.length; i++) {
            inputs[i].value = '';
        }
        applyFilters();
    }

    /**
     * Sort table by column
     * @param {string} column - Column name to sort by
     */
    function sortTable(column) {
        if (sortColumn === column) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            sortColumn = column;
            sortDirection = 'asc';
        }
        sortAndRender();
    }

    /**
     * Sort data and render table
     */
    function sortAndRender() {
        filteredData.sort(function(a, b) {
            const aVal = a[sortColumn] || '';
            const bVal = b[sortColumn] || '';

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        renderTable();
    }

    /**
     * Create cell content for a column
     * @param {object} row - Data row
     * @param {string} column - Column name
     * @returns {HTMLElement} TD element
     */
    function createCellContent(row, column) {
        const td = document.createElement('td');

        if (column === 'scheduleindicator') {
            const scheduleStatus = DashboardCommon.getScheduleStatus(row.datescheduled);
            return DashboardCommon.createScheduleIndicator(scheduleStatus, row.datescheduled);
        } else if (column === 'type') {
            td.textContent = row.type || '';
            td.title = row.type || '';
        } else if (column === 'statusname') {
            let statusClass = 'status-badge';
            if (row.statusname === 'Entered') statusClass += ' status-estimate';
            else if (row.statusname === 'Reconciled') statusClass += ' status-inprogress';
            else if (row.statusname === 'Received') statusClass += ' status-issued';
            const badge = document.createElement('span');
            badge.className = statusClass;
            badge.textContent = row.statusname || '';
            td.appendChild(badge);
            td.title = row.statusname || '';
        } else if (column === 'ordernum') {
            if (row.ordernum) {
                const orderLink = document.createElement('a');
                orderLink.href = '#';
                orderLink.className = 'order-link';
                orderLink.textContent = row.ordernum;
                orderLink.onclick = function(e) {
                    e.preventDefault();
                    openReceipt(row.ordernum);
                    return false;
                };
                td.appendChild(orderLink);
                td.title = row.ordernum;
            } else {
                td.textContent = '';
            }
        } else if (column === 'vendorname') {
            td.textContent = row.vendorname || '';
            td.title = row.vendorname || '';
        } else if (column === 'datescheduled') {
            td.textContent = DashboardCommon.formatDate(row.datescheduled);
            td.title = DashboardCommon.formatDate(row.datescheduled);
        }

        return td;
    }

    /**
     * Render table with current data
     */
    function renderTable() {
        const tbody = document.getElementById(containerId + '-tableBody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (filteredData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: #94a3b8;">No receipts found</td></tr>';
            return;
        }

        const columnOrder = ['scheduleindicator', 'type', 'statusname', 'ordernum', 'datescheduled', 'vendorname'];

        for (let i = 0; i < filteredData.length; i++) {
            const row = filteredData[i];
            const tr = document.createElement('tr');

            for (let j = 0; j < columnOrder.length; j++) {
                const cell = createCellContent(row, columnOrder[j]);
                tr.appendChild(cell);
            }

            tbody.appendChild(tr);
        }

        DashboardCommon.debugLog('Rendered ' + filteredData.length + ' rows', 'success', 'RCV');
    }

    /**
     * Open receipt in Fishbowl
     * @param {string} orderNum - Order number
     */
    function openReceipt(orderNum) {
        openModule('Receiving', orderNum);
    }

    /**
     * Refresh data
     */
    function refresh() {
        loadData();
    }

    // Public API
    return {
        init: init,
        refresh: refresh,
        applyFilters: applyFilters,
        clearFilters: clearFilters,
        sortTable: sortTable
    };
})();
