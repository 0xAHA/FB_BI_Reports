/**
 * Work Orders Dashboard Module
 * Displays open work orders with filtering, sorting, and click-through
 */

const ReportWO = (function() {
    'use strict';

    // Private variables
    let containerId = '';
    let allData = [];
    let filteredData = [];
    let sortColumn = 'datescheduled';
    let sortDirection = 'asc';

    /**
     * Initialize the Work Orders tile
     * @param {string} container - ID of the container element
     */
    function init(container) {
        containerId = container;
        DashboardCommon.debugLog('Initializing Work Orders module', 'info', 'WO');
        setupUI();
        loadData();
    }

    /**
     * Setup the UI structure
     */
    function setupUI() {
        const container = document.getElementById(containerId);
        if (!container) {
            DashboardCommon.debugLog('Container not found: ' + containerId, 'error', 'WO');
            return;
        }

        container.innerHTML = `
            <div class="tile-header">
                <div>
                    <h2 class="tile-title">Open Work Orders</h2>
                </div>
                <div class="tile-controls">
                    <span id="${containerId}-filterInfo" class="filter-info" style="display: none;"></span>
                    <button class="btn" onclick="ReportWO.clearFilters()">Clear Filters</button>
                    <button class="btn btn-primary" onclick="ReportWO.refresh()">Refresh</button>
                </div>
            </div>
            <div class="tile-table-container">
                <table class="tile-table">
                    <thead>
                        <tr>
                            <th data-column="scheduleindicator" class="schedule-col" onclick="ReportWO.sortTable('datescheduled')" title="Schedule Status">
                                <svg class="clock-icon" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z"/>
                                </svg>
                            </th>
                            <th data-column="statusname" onclick="ReportWO.sortTable('statusname')">Status <span class="sort-icon">⇅</span></th>
                            <th data-column="monum" onclick="ReportWO.sortTable('monum')">MO # <span class="sort-icon">⇅</span></th>
                            <th data-column="num" onclick="ReportWO.sortTable('num')">WO # <span class="sort-icon">⇅</span></th>
                            <th data-column="bomnum" onclick="ReportWO.sortTable('bomnum')">BOM # <span class="sort-icon">⇅</span></th>
                            <th data-column="qty" onclick="ReportWO.sortTable('qty')">Qty <span class="sort-icon">⇅</span></th>
                            <th data-column="datescheduledtostart" onclick="ReportWO.sortTable('datescheduledtostart')">Start Date <span class="sort-icon">⇅</span></th>
                            <th data-column="datescheduled" onclick="ReportWO.sortTable('datescheduled')">Scheduled Date <span class="sort-icon">⇅</span></th>
                        </tr>
                        <tr class="filter-row">
                            <td data-filter="scheduleindicator"></td>
                            <td><input type="text" data-filter="statusname" placeholder="Filter..." onkeyup="ReportWO.applyFilters()"></td>
                            <td><input type="text" data-filter="monum" placeholder="Filter..." onkeyup="ReportWO.applyFilters()"></td>
                            <td><input type="text" data-filter="num" placeholder="Filter..." onkeyup="ReportWO.applyFilters()"></td>
                            <td><input type="text" data-filter="bomnum" placeholder="Filter..." onkeyup="ReportWO.applyFilters()"></td>
                            <td><input type="text" data-filter="qty" placeholder="Filter..." onkeyup="ReportWO.applyFilters()"></td>
                            <td><input type="text" data-filter="datescheduledtostart" placeholder="Filter..." onkeyup="ReportWO.applyFilters()"></td>
                            <td><input type="text" data-filter="datescheduled" placeholder="Filter..." onkeyup="ReportWO.applyFilters()"></td>
                        </tr>
                    </thead>
                    <tbody id="${containerId}-tableBody">
                        <tr>
                            <td colspan="8" style="text-align: center; padding: 20px; color: #94a3b8;">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    /**
     * Load work orders data
     */
    function loadData() {
        DashboardCommon.debugLog('Starting data load...', 'info', 'WO');

        try {
            const currentUser = JSON.parse(getUser());
            const userId = currentUser.id;
            DashboardCommon.debugLog('Current user ID: ' + userId, 'info', 'WO');

            const query =
                "SELECT " +
                "    Wo.id AS id, " +
                "    Wo.num AS num, " +
                "    Wo.dateScheduled AS dateScheduled, " +
                "    COALESCE(Wo.dateScheduledToStart, Wo.dateStarted) AS dateScheduledToStart, " +
                "    WoStatus.Name AS statusName, " +
                "    Mo.num AS moNum, " +
                "    Bom.num AS bomNum, " +
                "    MoItem.qtyToFulfill AS qty " +
                "FROM Wo " +
                "LEFT JOIN WoStatus ON Wo.statusId = WoStatus.Id " +
                "LEFT JOIN MoItem ON Wo.moItemId = MoItem.id " +
                "LEFT JOIN Mo ON MoItem.moId = Mo.id " +
                "LEFT JOIN Bom ON MoItem.bomId = Bom.id " +
                "INNER JOIN UserToLG ON Wo.locationGroupId = UserToLG.LocationGroupId AND UserToLG.UserId = " + userId + " " +
                "WHERE Wo.statusId IN (10, 30) " +
                "ORDER BY dateScheduled ASC";

            DashboardCommon.debugLog('Executing SQL query...', 'query', 'WO');

            const queryResult = runQuery(query);
            const result = JSON.parse(queryResult);

            DashboardCommon.debugLog('Parsed ' + result.length + ' records', 'success', 'WO');

            allData = result;
            applyFilters();

            DashboardCommon.debugLog('Load complete: ' + filteredData.length + ' work orders displayed', 'success', 'WO');

        } catch (error) {
            DashboardCommon.debugLog('ERROR: ' + error.message, 'error', 'WO');
            console.error('Error loading work orders:', error);
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
            filterInfo.textContent = 'Showing ' + filteredData.length + ' of ' + allData.length + ' work orders';
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
        } else if (column === 'statusname') {
            const badge = document.createElement('span');
            badge.className = 'status-badge';
            badge.textContent = row.statusname || '';
            td.appendChild(badge);
            td.title = row.statusname || '';
        } else if (column === 'num') {
            const orderLink = document.createElement('a');
            orderLink.href = '#';
            orderLink.className = 'order-link';
            orderLink.textContent = row.num;
            orderLink.onclick = function(e) {
                e.preventDefault();
                openWO(row.num);
                return false;
            };
            td.appendChild(orderLink);
            td.title = row.num;
        } else if (column === 'monum' || column === 'bomnum' || column === 'qty') {
            td.textContent = row[column] || '';
            td.title = row[column] || '';
        } else if (column === 'datescheduled' || column === 'datescheduledtostart') {
            td.textContent = DashboardCommon.formatDate(row[column]);
            td.title = DashboardCommon.formatDate(row[column]);
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
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #94a3b8;">No work orders found</td></tr>';
            return;
        }

        const columnOrder = ['scheduleindicator', 'statusname', 'monum', 'num', 'bomnum', 'qty', 'datescheduledtostart', 'datescheduled'];

        for (let i = 0; i < filteredData.length; i++) {
            const row = filteredData[i];
            const tr = document.createElement('tr');

            for (let j = 0; j < columnOrder.length; j++) {
                const cell = createCellContent(row, columnOrder[j]);
                tr.appendChild(cell);
            }

            tbody.appendChild(tr);
        }

        DashboardCommon.debugLog('Rendered ' + filteredData.length + ' rows', 'success', 'WO');
    }

    /**
     * Open work order in Fishbowl
     * @param {string} orderNum - Order number
     */
    function openWO(orderNum) {
        openModule("Work Order", orderNum);
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
