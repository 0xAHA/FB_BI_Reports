/**
 * Sales Orders Dashboard Module
 * Displays open sales orders with filtering, sorting, and click-through
 */

const ReportSO = (function() {
    'use strict';

    // Private variables
    let containerId = '';
    let allData = [];
    let filteredData = [];
    let sortColumn = 'dateissued';
    let sortDirection = 'desc';

    // Get properties
    const HIDE_ESTIMATES_DEFAULT = false;
    const BI_SO_SHOW_ESTIMATE_PROP = getProperty('BI_SO_SHOW_ESTIMATE', HIDE_ESTIMATES_DEFAULT ? 'false' : 'true');
    const HIDE_ESTIMATES = BI_SO_SHOW_ESTIMATE_PROP === 'false' || BI_SO_SHOW_ESTIMATE_PROP === false;

    /**
     * Initialize the Sales Orders tile
     * @param {string} container - ID of the container element
     */
    function init(container) {
        containerId = container;
        DashboardCommon.debugLog('Initializing Sales Orders module', 'info', 'SO');
        setupUI();
        loadData();
    }

    /**
     * Setup the UI structure
     */
    function setupUI() {
        const container = document.getElementById(containerId);
        if (!container) {
            DashboardCommon.debugLog('Container not found: ' + containerId, 'error', 'SO');
            return;
        }

        container.innerHTML = `
            <div class="tile-header">
                <div>
                    <h2 class="tile-title">Open Sales Orders</h2>
                </div>
                <div class="tile-controls">
                    <label class="hide-estimates-label">
                        <input type="checkbox" id="${containerId}-hideEstimates" ${HIDE_ESTIMATES ? 'checked' : ''}>
                        Hide Estimates
                    </label>
                    <span id="${containerId}-filterInfo" class="filter-info" style="display: none;"></span>
                    <button class="btn" onclick="ReportSO.clearFilters()">Clear Filters</button>
                    <button class="btn btn-primary" onclick="ReportSO.refresh()">Refresh</button>
                </div>
            </div>
            <div class="tile-table-container">
                <table class="tile-table">
                    <thead>
                        <tr>
                            <th data-column="statusname" onclick="ReportSO.sortTable('statusname')">Status <span class="sort-icon">⇅</span></th>
                            <th data-column="scheduleindicator" class="schedule-col" onclick="ReportSO.sortTable('datefirstship')" title="Schedule Status">
                                <svg class="clock-icon" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z"/>
                                </svg>
                            </th>
                            <th data-column="num" onclick="ReportSO.sortTable('num')">Number <span class="sort-icon">⇅</span></th>
                            <th data-column="customername" onclick="ReportSO.sortTable('customername')">Customer <span class="sort-icon">⇅</span></th>
                            <th data-column="customerpo" onclick="ReportSO.sortTable('customerpo')">Customer PO <span class="sort-icon">⇅</span></th>
                            <th data-column="dateissued" onclick="ReportSO.sortTable('dateissued')">Date Issued <span class="sort-icon">⇅</span></th>
                            <th data-column="datefirstship" onclick="ReportSO.sortTable('datefirstship')">Date Scheduled <span class="sort-icon">⇅</span></th>
                        </tr>
                        <tr class="filter-row">
                            <td><input type="text" data-filter="statusname" placeholder="Filter..." onkeyup="ReportSO.applyFilters()"></td>
                            <td data-filter="scheduleindicator"></td>
                            <td><input type="text" data-filter="num" placeholder="Filter..." onkeyup="ReportSO.applyFilters()"></td>
                            <td><input type="text" data-filter="customername" placeholder="Filter..." onkeyup="ReportSO.applyFilters()"></td>
                            <td><input type="text" data-filter="customerpo" placeholder="Filter..." onkeyup="ReportSO.applyFilters()"></td>
                            <td><input type="text" data-filter="dateissued" placeholder="Filter..." onkeyup="ReportSO.applyFilters()"></td>
                            <td><input type="text" data-filter="datefirstship" placeholder="Filter..." onkeyup="ReportSO.applyFilters()"></td>
                        </tr>
                    </thead>
                    <tbody id="${containerId}-tableBody">
                        <tr>
                            <td colspan="7" style="text-align: center; padding: 20px; color: #94a3b8;">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;

        // Add event listener for hide estimates checkbox
        const checkbox = document.getElementById(containerId + '-hideEstimates');
        if (checkbox) {
            checkbox.addEventListener('change', applyFilters);
        }
    }

    /**
     * Load sales orders data
     */
    function loadData() {
        DashboardCommon.debugLog('Starting data load...', 'info', 'SO');

        try {
            // Get current user
            const currentUser = JSON.parse(getUser());
            const userId = currentUser.id;
            DashboardCommon.debugLog('Current user ID: ' + userId, 'info', 'SO');

            const query =
                "SELECT " +
                "    So.Id AS id, " +
                "    So.Num AS num, " +
                "    So.CustomerPO AS customerPO, " +
                "    So.DateIssued AS dateIssued, " +
                "    So.DateFirstShip AS dateFirstShip, " +
                "    Customer.Name AS customerName, " +
                "    SoStatus.Name AS statusName " +
                "FROM So " +
                "LEFT JOIN Customer ON So.CustomerId = Customer.Id " +
                "LEFT JOIN SoStatus ON So.StatusId = SoStatus.Id " +
                "INNER JOIN UserToLG ON So.LocationGroupId = UserToLG.LocationGroupId AND UserToLG.UserId = " + userId + " " +
                "WHERE SoStatus.Name IN ('Estimate', 'In Progress', 'Issued') " +
                "ORDER BY So.DateIssued DESC";

            DashboardCommon.debugLog('Executing SQL query...', 'query', 'SO');

            const queryResult = runQuery(query);
            const result = JSON.parse(queryResult);

            DashboardCommon.debugLog('Parsed ' + result.length + ' records', 'success', 'SO');

            allData = result;
            applyFilters();

            DashboardCommon.debugLog('Load complete: ' + filteredData.length + ' orders displayed', 'success', 'SO');

        } catch (error) {
            DashboardCommon.debugLog('ERROR: ' + error.message, 'error', 'SO');
            console.error('Error loading sales orders:', error);
        }
    }

    /**
     * Apply filters to data
     */
    function applyFilters() {
        const hideEstimatesCheckbox = document.getElementById(containerId + '-hideEstimates');
        const hideEstimates = hideEstimatesCheckbox ? hideEstimatesCheckbox.checked : false;

        filteredData = allData.filter(function(row) {
            // Hide estimates filter
            if (hideEstimates && row.statusname === 'Estimate') {
                return false;
            }

            // Column filters
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
            filterInfo.textContent = 'Showing ' + filteredData.length + ' of ' + allData.length + ' orders';
            filterInfo.style.display = 'inline-block';
        } else {
            filterInfo.style.display = 'none';
        }
    }

    /**
     * Clear all filters
     */
    function clearFilters() {
        const checkbox = document.getElementById(containerId + '-hideEstimates');
        if (checkbox) checkbox.checked = false;

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

        if (column === 'statusname') {
            let statusClass = 'status-badge';
            if (row.statusname === 'Estimate') statusClass += ' status-estimate';
            else if (row.statusname === 'In Progress') statusClass += ' status-inprogress';
            else if (row.statusname === 'Issued') statusClass += ' status-issued';
            const badge = document.createElement('span');
            badge.className = statusClass;
            badge.textContent = row.statusname || '';
            td.appendChild(badge);
            td.title = row.statusname || '';
        } else if (column === 'scheduleindicator') {
            const scheduleStatus = DashboardCommon.getScheduleStatus(row.datefirstship);
            return DashboardCommon.createScheduleIndicator(scheduleStatus, row.datefirstship);
        } else if (column === 'num') {
            const orderLink = document.createElement('a');
            orderLink.href = '#';
            orderLink.className = 'order-link';
            orderLink.textContent = row.num;
            orderLink.onclick = function(e) {
                e.preventDefault();
                openSO(row.num);
                return false;
            };
            td.appendChild(orderLink);
            td.title = row.num;
        } else if (column === 'customername') {
            td.textContent = row.customername || '';
            td.title = row.customername || '';
        } else if (column === 'customerpo') {
            td.textContent = row.customerpo || '';
            td.title = row.customerpo || '';
        } else if (column === 'dateissued' || column === 'datefirstship') {
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
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #94a3b8;">No sales orders found</td></tr>';
            return;
        }

        const columnOrder = ['statusname', 'scheduleindicator', 'num', 'customername', 'customerpo', 'dateissued', 'datefirstship'];

        for (let i = 0; i < filteredData.length; i++) {
            const row = filteredData[i];
            const tr = document.createElement('tr');

            for (let j = 0; j < columnOrder.length; j++) {
                const cell = createCellContent(row, columnOrder[j]);
                tr.appendChild(cell);
            }

            tbody.appendChild(tr);
        }

        DashboardCommon.debugLog('Rendered ' + filteredData.length + ' rows', 'success', 'SO');
    }

    /**
     * Open sales order in Fishbowl
     * @param {string} orderNum - Order number
     */
    function openSO(orderNum) {
        openModule("Sales Order", orderNum);
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
