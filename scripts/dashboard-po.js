/**
 * Purchase Orders Dashboard Module
 * Displays open purchase orders with filtering, sorting, and click-through
 */

const ReportPO = (function() {
    'use strict';

    // Private variables
    let containerId = '';
    let allData = [];
    let filteredData = [];
    let sortColumn = 'dateissued';
    let sortDirection = 'desc';

    // Get properties
    const HIDE_BID_REQUESTS_DEFAULT = false;
    const BI_PO_SHOW_BID_REQUEST_PROP = getProperty('BI_PO_SHOW_BID_REQUEST', HIDE_BID_REQUESTS_DEFAULT ? 'false' : 'true');
    const HIDE_BID_REQUESTS = BI_PO_SHOW_BID_REQUEST_PROP === 'false' || BI_PO_SHOW_BID_REQUEST_PROP === false;

    /**
     * Initialize the Purchase Orders tile
     * @param {string} container - ID of the container element
     */
    function init(container) {
        containerId = container;
        DashboardCommon.debugLog('Initializing Purchase Orders module', 'info', 'PO');
        setupUI();
        loadData();
    }

    /**
     * Setup the UI structure
     */
    function setupUI() {
        const container = document.getElementById(containerId);
        if (!container) {
            DashboardCommon.debugLog('Container not found: ' + containerId, 'error', 'PO');
            return;
        }

        container.innerHTML = `
            <div class="tile-header">
                <div>
                    <h2 class="tile-title">Open Purchase Orders</h2>
                </div>
                <div class="tile-controls">
                    <label class="hide-estimates-label">
                        <input type="checkbox" id="${containerId}-hideBidRequests" ${HIDE_BID_REQUESTS ? 'checked' : ''}>
                        Hide Bid Requests
                    </label>
                    <span id="${containerId}-filterInfo" class="filter-info" style="display: none;"></span>
                    <button class="btn" onclick="ReportPO.clearFilters()">Clear Filters</button>
                    <button class="btn btn-primary" onclick="ReportPO.refresh()">Refresh</button>
                </div>
            </div>
            <div class="tile-table-container">
                <table class="tile-table">
                    <thead>
                        <tr>
                            <th data-column="statusname" onclick="ReportPO.sortTable('statusname')">Status <span class="sort-icon">⇅</span></th>
                            <th data-column="scheduleindicator" class="schedule-col" onclick="ReportPO.sortTable('datescheduled')" title="Schedule Status">
                                <svg class="clock-icon" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z"/>
                                </svg>
                            </th>
                            <th data-column="num" onclick="ReportPO.sortTable('num')">Number <span class="sort-icon">⇅</span></th>
                            <th data-column="vendorname" onclick="ReportPO.sortTable('vendorname')">Vendor <span class="sort-icon">⇅</span></th>
                            <th data-column="customerso" onclick="ReportPO.sortTable('customerso')">Customer SO <span class="sort-icon">⇅</span></th>
                            <th data-column="dateissued" onclick="ReportPO.sortTable('dateissued')">Date Issued <span class="sort-icon">⇅</span></th>
                            <th data-column="datescheduled" onclick="ReportPO.sortTable('datescheduled')">Date Scheduled <span class="sort-icon">⇅</span></th>
                        </tr>
                        <tr class="filter-row">
                            <td><input type="text" data-filter="statusname" placeholder="Filter..." onkeyup="ReportPO.applyFilters()"></td>
                            <td data-filter="scheduleindicator"></td>
                            <td><input type="text" data-filter="num" placeholder="Filter..." onkeyup="ReportPO.applyFilters()"></td>
                            <td><input type="text" data-filter="vendorname" placeholder="Filter..." onkeyup="ReportPO.applyFilters()"></td>
                            <td><input type="text" data-filter="customerso" placeholder="Filter..." onkeyup="ReportPO.applyFilters()"></td>
                            <td><input type="text" data-filter="dateissued" placeholder="Filter..." onkeyup="ReportPO.applyFilters()"></td>
                            <td><input type="text" data-filter="datescheduled" placeholder="Filter..." onkeyup="ReportPO.applyFilters()"></td>
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

        // Add event listener for hide bid requests checkbox
        const checkbox = document.getElementById(containerId + '-hideBidRequests');
        if (checkbox) {
            checkbox.addEventListener('change', applyFilters);
        }
    }

    /**
     * Load purchase orders data
     */
    function loadData() {
        DashboardCommon.debugLog('Starting data load...', 'info', 'PO');

        try {
            // Get current user
            const currentUser = JSON.parse(getUser());
            const userId = currentUser.id;
            DashboardCommon.debugLog('Current user ID: ' + userId, 'info', 'PO');

            const query =
                "SELECT " +
                "    Po.Id AS id, " +
                "    Po.Num AS num, " +
                "    Po.CustomerSO AS customerSO, " +
                "    Po.DateIssued AS dateIssued, " +
                "    Po.DateFirstShip AS dateScheduled, " +
                "    Vendor.Name AS vendorName, " +
                "    PoStatus.Name AS statusName " +
                "FROM Po " +
                "LEFT JOIN Vendor ON Po.VendorId = Vendor.Id " +
                "LEFT JOIN PoStatus ON Po.StatusId = PoStatus.Id " +
                "INNER JOIN UserToLG ON Po.LocationGroupId = UserToLG.LocationGroupId AND UserToLG.UserId = " + userId + " " +
                "WHERE PoStatus.Name IN ('Bid Request', 'Pending Approval', 'Issued', 'Picking', 'Partial', 'Picked') " +
                "ORDER BY Po.DateIssued DESC";

            DashboardCommon.debugLog('Executing SQL query...', 'query', 'PO');

            const queryResult = runQuery(query);
            const result = JSON.parse(queryResult);

            DashboardCommon.debugLog('Parsed ' + result.length + ' records', 'success', 'PO');

            allData = result;
            applyFilters();

            DashboardCommon.debugLog('Load complete: ' + filteredData.length + ' orders displayed', 'success', 'PO');

        } catch (error) {
            DashboardCommon.debugLog('ERROR: ' + error.message, 'error', 'PO');
            console.error('Error loading purchase orders:', error);
        }
    }

    /**
     * Apply filters to data
     */
    function applyFilters() {
        const hideBidRequestsCheckbox = document.getElementById(containerId + '-hideBidRequests');
        const hideBidRequests = hideBidRequestsCheckbox ? hideBidRequestsCheckbox.checked : false;

        filteredData = allData.filter(function(row) {
            // Hide bid requests filter
            if (hideBidRequests && row.statusname === 'Bid Request') {
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
        const checkbox = document.getElementById(containerId + '-hideBidRequests');
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
            const badge = document.createElement('span');
            badge.className = 'status-badge';
            badge.textContent = row.statusname || '';
            td.appendChild(badge);
            td.title = row.statusname || '';
        } else if (column === 'scheduleindicator') {
            const scheduleStatus = DashboardCommon.getScheduleStatus(row.datescheduled);
            return DashboardCommon.createScheduleIndicator(scheduleStatus, row.datescheduled);
        } else if (column === 'num') {
            const orderLink = document.createElement('a');
            orderLink.href = '#';
            orderLink.className = 'order-link';
            orderLink.textContent = row.num;
            orderLink.onclick = function(e) {
                e.preventDefault();
                openPO(row.num);
                return false;
            };
            td.appendChild(orderLink);
            td.title = row.num;
        } else if (column === 'vendorname' || column === 'customerso') {
            td.textContent = row[column] || '';
            td.title = row[column] || '';
        } else if (column === 'dateissued' || column === 'datescheduled') {
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
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #94a3b8;">No purchase orders found</td></tr>';
            return;
        }

        const columnOrder = ['statusname', 'scheduleindicator', 'num', 'vendorname', 'customerso', 'dateissued', 'datescheduled'];

        for (let i = 0; i < filteredData.length; i++) {
            const row = filteredData[i];
            const tr = document.createElement('tr');

            for (let j = 0; j < columnOrder.length; j++) {
                const cell = createCellContent(row, columnOrder[j]);
                tr.appendChild(cell);
            }

            tbody.appendChild(tr);
        }

        DashboardCommon.debugLog('Rendered ' + filteredData.length + ' rows', 'success', 'PO');
    }

    /**
     * Open purchase order in Fishbowl
     * @param {string} orderNum - Order number
     */
    function openPO(orderNum) {
        openModule("Purchase Order", orderNum);
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
