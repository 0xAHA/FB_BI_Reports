/**
 * Transfer Orders Dashboard Module
 * Displays open transfer orders with filtering, sorting, and click-through
 */

const ReportTO = (function() {
    'use strict';

    // Private variables
    let containerId = '';
    let allData = [];
    let filteredData = [];
    let sortColumn = 'datescheduled';
    let sortDirection = 'asc';

    /**
     * Initialize the Transfer Orders tile
     * @param {string} container - ID of the container element
     */
    function init(container) {
        containerId = container;
        DashboardCommon.debugLog('Initializing Transfer Orders module', 'info', 'TO');
        setupUI();
        loadData();
    }

    /**
     * Setup the UI structure
     */
    function setupUI() {
        const container = document.getElementById(containerId);
        if (!container) {
            DashboardCommon.debugLog('Container not found: ' + containerId, 'error', 'TO');
            return;
        }

        container.innerHTML = `
            <div class="tile-header">
                <div>
                    <h2 class="tile-title">Open Transfer Orders</h2>
                </div>
                <div class="tile-controls">
                    <span id="${containerId}-filterInfo" class="filter-info" style="display: none;"></span>
                    <button class="btn" onclick="ReportTO.clearFilters()">Clear Filters</button>
                    <button class="btn btn-primary" onclick="ReportTO.refresh()">Refresh</button>
                </div>
            </div>
            <div class="tile-table-container">
                <table class="tile-table">
                    <thead>
                        <tr>
                            <th data-column="scheduleindicator" class="schedule-col" onclick="ReportTO.sortTable('datescheduled')" title="Schedule Status">
                                <svg class="clock-icon" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z"/>
                                </svg>
                            </th>
                            <th data-column="type" onclick="ReportTO.sortTable('type')">Type <span class="sort-icon">⇅</span></th>
                            <th data-column="statusname" onclick="ReportTO.sortTable('statusname')">Status <span class="sort-icon">⇅</span></th>
                            <th data-column="num" onclick="ReportTO.sortTable('num')">Number <span class="sort-icon">⇅</span></th>
                            <th data-column="datescheduled" onclick="ReportTO.sortTable('datescheduled')">Date Scheduled <span class="sort-icon">⇅</span></th>
                            <th data-column="dateissued" onclick="ReportTO.sortTable('dateissued')">Date Issued <span class="sort-icon">⇅</span></th>
                            <th data-column="fromname" onclick="ReportTO.sortTable('fromname')">From <span class="sort-icon">⇅</span></th>
                            <th data-column="toname" onclick="ReportTO.sortTable('toname')">To <span class="sort-icon">⇅</span></th>
                        </tr>
                        <tr class="filter-row">
                            <td data-filter="scheduleindicator"></td>
                            <td><input type="text" data-filter="type" placeholder="Filter..." onkeyup="ReportTO.applyFilters()"></td>
                            <td><input type="text" data-filter="statusname" placeholder="Filter..." onkeyup="ReportTO.applyFilters()"></td>
                            <td><input type="text" data-filter="num" placeholder="Filter..." onkeyup="ReportTO.applyFilters()"></td>
                            <td><input type="text" data-filter="datescheduled" placeholder="Filter..." onkeyup="ReportTO.applyFilters()"></td>
                            <td><input type="text" data-filter="dateissued" placeholder="Filter..." onkeyup="ReportTO.applyFilters()"></td>
                            <td><input type="text" data-filter="fromname" placeholder="Filter..." onkeyup="ReportTO.applyFilters()"></td>
                            <td><input type="text" data-filter="toname" placeholder="Filter..." onkeyup="ReportTO.applyFilters()"></td>
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
     * Load transfer orders data
     */
    function loadData() {
        DashboardCommon.debugLog('Starting data load...', 'info', 'TO');

        try {
            const currentUser = JSON.parse(getUser());
            const userId = currentUser.id;
            DashboardCommon.debugLog('Current user ID: ' + userId, 'info', 'TO');

            const query =
                "SELECT " +
                "    Xo.id AS id, " +
                "    Xo.num AS num, " +
                "    Xo.dateIssued AS dateIssued, " +
                "    COALESCE(Xo.dateFirstShip, Xo.dateScheduled) AS dateScheduled, " +
                "    XoStatus.Name AS statusName, " +
                "    XoType.Name AS typeName, " +
                "    FromLG.Name AS fromName, " +
                "    ToLG.Name AS toName " +
                "FROM Xo " +
                "LEFT JOIN XoStatus ON Xo.statusId = XoStatus.Id " +
                "LEFT JOIN XoType ON Xo.typeId = XoType.Id " +
                "LEFT JOIN locationGroup AS FromLG ON Xo.fromLGId = FromLG.Id " +
                "LEFT JOIN locationGroup AS ToLG ON Xo.shipToLGId = ToLG.Id " +
                "INNER JOIN UserToLG ON Xo.fromLGId = UserToLG.LocationGroupId AND UserToLG.UserId = " + userId + " " +
                "WHERE Xo.statusId IN (10, 15, 20, 30, 40, 50, 60) " +
                "ORDER BY dateScheduled ASC";

            DashboardCommon.debugLog('Executing SQL query...', 'query', 'TO');

            const queryResult = runQuery(query);
            const result = JSON.parse(queryResult);

            DashboardCommon.debugLog('Parsed ' + result.length + ' records', 'success', 'TO');

            // Add type field for filtering
            for (let i = 0; i < result.length; i++) {
                result[i].type = result[i].typename || '';
            }

            allData = result;
            applyFilters();

            DashboardCommon.debugLog('Load complete: ' + filteredData.length + ' transfer orders displayed', 'success', 'TO');

        } catch (error) {
            DashboardCommon.debugLog('ERROR: ' + error.message, 'error', 'TO');
            console.error('Error loading transfer orders:', error);
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
            filterInfo.textContent = 'Showing ' + filteredData.length + ' of ' + allData.length + ' transfer orders';
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
            else if (row.statusname === 'Request') statusClass += ' status-estimate';
            else if (row.statusname === 'Issued') statusClass += ' status-issued';
            else if (row.statusname === 'Picking') statusClass += ' status-inprogress';
            else if (row.statusname === 'Partial') statusClass += ' status-inprogress';
            else if (row.statusname === 'Picked') statusClass += ' status-issued';
            else if (row.statusname === 'Shipped') statusClass += ' status-issued';
            const badge = document.createElement('span');
            badge.className = statusClass;
            badge.textContent = row.statusname || '';
            td.appendChild(badge);
            td.title = row.statusname || '';
        } else if (column === 'num') {
            const toLink = document.createElement('a');
            toLink.href = '#';
            toLink.className = 'order-link';
            toLink.textContent = row.num;
            toLink.onclick = function(e) {
                e.preventDefault();
                openTO(row.num);
                return false;
            };
            td.appendChild(toLink);
            td.title = row.num;
        } else if (column === 'datescheduled' || column === 'dateissued') {
            td.textContent = DashboardCommon.formatDate(row[column]);
            td.title = DashboardCommon.formatDate(row[column]);
        } else if (column === 'fromname' || column === 'toname') {
            td.textContent = row[column] || '';
            td.title = row[column] || '';
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
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #94a3b8;">No transfer orders found</td></tr>';
            return;
        }

        const columnOrder = ['scheduleindicator', 'type', 'statusname', 'num', 'datescheduled', 'dateissued', 'fromname', 'toname'];

        for (let i = 0; i < filteredData.length; i++) {
            const row = filteredData[i];
            const tr = document.createElement('tr');

            for (let j = 0; j < columnOrder.length; j++) {
                const cell = createCellContent(row, columnOrder[j]);
                tr.appendChild(cell);
            }

            tbody.appendChild(tr);
        }

        DashboardCommon.debugLog('Rendered ' + filteredData.length + ' rows', 'success', 'TO');
    }

    /**
     * Open transfer order in Fishbowl
     * @param {string} orderNum - Order number
     */
    function openTO(orderNum) {
        openModule("Transfer Order", orderNum);
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
