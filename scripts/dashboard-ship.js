/**
 * Items To Be Shipped Dashboard Module
 * Displays shipment items with filtering, sorting, and click-through
 */

const ReportSHIP = (function() {
    'use strict';

    // Private variables
    let containerId = '';
    let allData = [];
    let filteredData = [];
    let sortColumn = 'datescheduled';
    let sortDirection = 'asc';

    /**
     * Initialize the Shipments tile
     * @param {string} container - ID of the container element
     */
    function init(container) {
        containerId = container;
        DashboardCommon.debugLog('Initializing Shipments module', 'info', 'SHIP');
        setupUI();
        loadData();
    }

    /**
     * Setup the UI structure
     */
    function setupUI() {
        const container = document.getElementById(containerId);
        if (!container) {
            DashboardCommon.debugLog('Container not found: ' + containerId, 'error', 'SHIP');
            return;
        }

        container.innerHTML = `
            <div class="tile-header">
                <div>
                    <h2 class="tile-title">Items To Be Shipped</h2>
                </div>
                <div class="tile-controls">
                    <span id="${containerId}-filterInfo" class="filter-info" style="display: none;"></span>
                    <button class="btn" onclick="ReportSHIP.clearFilters()">Clear Filters</button>
                    <button class="btn btn-primary" onclick="ReportSHIP.refresh()">Refresh</button>
                </div>
            </div>
            <div class="tile-table-container">
                <table class="tile-table">
                    <thead>
                        <tr>
                            <th data-column="scheduleindicator" class="schedule-col" onclick="ReportSHIP.sortTable('datescheduled')" title="Schedule Status">
                                <svg class="clock-icon" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z"/>
                                </svg>
                            </th>
                            <th data-column="type" onclick="ReportSHIP.sortTable('type')">Type <span class="sort-icon">⇅</span></th>
                            <th data-column="statusname" onclick="ReportSHIP.sortTable('statusname')">Status <span class="sort-icon">⇅</span></th>
                            <th data-column="num" onclick="ReportSHIP.sortTable('num')">Number <span class="sort-icon">⇅</span></th>
                            <th data-column="ordernum" onclick="ReportSHIP.sortTable('ordernum')">Order # <span class="sort-icon">⇅</span></th>
                            <th data-column="datescheduled" onclick="ReportSHIP.sortTable('datescheduled')">Scheduled Date <span class="sort-icon">⇅</span></th>
                            <th data-column="shipto" onclick="ReportSHIP.sortTable('shipto')">Ship To <span class="sort-icon">⇅</span></th>
                            <th data-column="carrier" onclick="ReportSHIP.sortTable('carrier')">Carrier <span class="sort-icon">⇅</span></th>
                            <th data-column="service" onclick="ReportSHIP.sortTable('service')">Service <span class="sort-icon">⇅</span></th>
                        </tr>
                        <tr class="filter-row">
                            <td data-filter="scheduleindicator"></td>
                            <td><input type="text" data-filter="type" placeholder="Filter..." onkeyup="ReportSHIP.applyFilters()"></td>
                            <td><input type="text" data-filter="statusname" placeholder="Filter..." onkeyup="ReportSHIP.applyFilters()"></td>
                            <td><input type="text" data-filter="num" placeholder="Filter..." onkeyup="ReportSHIP.applyFilters()"></td>
                            <td><input type="text" data-filter="ordernum" placeholder="Filter..." onkeyup="ReportSHIP.applyFilters()"></td>
                            <td><input type="text" data-filter="datescheduled" placeholder="Filter..." onkeyup="ReportSHIP.applyFilters()"></td>
                            <td><input type="text" data-filter="shipto" placeholder="Filter..." onkeyup="ReportSHIP.applyFilters()"></td>
                            <td><input type="text" data-filter="carrier" placeholder="Filter..." onkeyup="ReportSHIP.applyFilters()"></td>
                            <td><input type="text" data-filter="service" placeholder="Filter..." onkeyup="ReportSHIP.applyFilters()"></td>
                        </tr>
                    </thead>
                    <tbody id="${containerId}-tableBody">
                        <tr>
                            <td colspan="9" style="text-align: center; padding: 20px; color: #94a3b8;">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    /**
     * Load shipments data
     */
    function loadData() {
        DashboardCommon.debugLog('Starting data load...', 'info', 'SHIP');

        try {
            const currentUser = JSON.parse(getUser());
            const userId = currentUser.id;
            DashboardCommon.debugLog('Current user ID: ' + userId, 'info', 'SHIP');

            const query =
                "SELECT " +
                "    Ship.Id AS id, " +
                "    Ship.Num AS num, " +
                "    Ship.OrderTypeId AS orderTypeId, " +
                "    Ship.ShipToName AS shipTo, " +
                "    ShipStatus.Name AS statusName, " +
                "    Carrier.Name AS carrier, " +
                "    CarrierService.Name AS service, " +
                "    CASE " +
                "        WHEN Ship.OrderTypeId = 20 THEN So.Num " +
                "        WHEN Ship.OrderTypeId = 10 THEN Po.Num " +
                "        WHEN Ship.OrderTypeId = 40 THEN Xo.Num " +
                "    END AS orderNum, " +
                "    COALESCE(So.DateFirstShip, Po.DateFirstShip, Xo.DateScheduled) AS dateScheduled " +
                "FROM Ship " +
                "LEFT JOIN ShipStatus ON Ship.StatusId = ShipStatus.Id " +
                "LEFT JOIN Carrier ON Ship.CarrierId = Carrier.Id " +
                "LEFT JOIN CarrierService ON Ship.CarrierServiceId = CarrierService.Id " +
                "LEFT JOIN So ON Ship.SoId = So.Id " +
                "LEFT JOIN Po ON Ship.PoId = Po.Id " +
                "LEFT JOIN Xo ON Ship.XoId = Xo.Id " +
                "INNER JOIN UserToLG ON Ship.LocationGroupId = UserToLG.LocationGroupId AND UserToLG.UserId = " + userId + " " +
                "WHERE ShipStatus.Name IN ('Entered', 'Packed') " +
                "ORDER BY dateScheduled ASC";

            DashboardCommon.debugLog('Executing SQL query...', 'query', 'SHIP');

            const queryResult = runQuery(query);
            const result = JSON.parse(queryResult);

            DashboardCommon.debugLog('Parsed ' + result.length + ' records', 'success', 'SHIP');

            // Add type prefix
            for (let i = 0; i < result.length; i++) {
                if (result[i].ordertypeid === 10) result[i].type = 'PO';
                else if (result[i].ordertypeid === 20) result[i].type = 'SO';
                else if (result[i].ordertypeid === 30) result[i].type = 'WO';
                else if (result[i].ordertypeid === 40) result[i].type = 'TO';
                else result[i].type = '';
            }

            allData = result;
            applyFilters();

            DashboardCommon.debugLog('Load complete: ' + filteredData.length + ' shipments displayed', 'success', 'SHIP');

        } catch (error) {
            DashboardCommon.debugLog('ERROR: ' + error.message, 'error', 'SHIP');
            console.error('Error loading shipments:', error);
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
            filterInfo.textContent = 'Showing ' + filteredData.length + ' of ' + allData.length + ' shipments';
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
            else if (row.statusname === 'Packed') statusClass += ' status-inprogress';
            else if (row.statusname === 'Shipped') statusClass += ' status-issued';
            const badge = document.createElement('span');
            badge.className = statusClass;
            badge.textContent = row.statusname || '';
            td.appendChild(badge);
            td.title = row.statusname || '';
        } else if (column === 'num') {
            const shipLink = document.createElement('a');
            shipLink.href = '#';
            shipLink.className = 'order-link';
            shipLink.textContent = row.num;
            shipLink.onclick = function(e) {
                e.preventDefault();
                openShip(row.num);
                return false;
            };
            td.appendChild(shipLink);
            td.title = row.num;
        } else if (column === 'ordernum') {
            if (row.ordernum) {
                const orderLink = document.createElement('a');
                orderLink.href = '#';
                orderLink.className = 'order-link';
                orderLink.textContent = row.ordernum;
                orderLink.onclick = function(e) {
                    e.preventDefault();
                    openOrder(row.ordernum, row.ordertypeid);
                    return false;
                };
                td.appendChild(orderLink);
                td.title = row.ordernum;
            } else {
                td.textContent = '';
            }
        } else if (column === 'datescheduled') {
            td.textContent = DashboardCommon.formatDate(row.datescheduled);
            td.title = DashboardCommon.formatDate(row.datescheduled);
        } else if (column === 'shipto' || column === 'carrier' || column === 'service') {
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
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: #94a3b8;">No shipments found</td></tr>';
            return;
        }

        const columnOrder = ['scheduleindicator', 'type', 'statusname', 'num', 'ordernum', 'datescheduled', 'shipto', 'carrier', 'service'];

        for (let i = 0; i < filteredData.length; i++) {
            const row = filteredData[i];
            const tr = document.createElement('tr');

            for (let j = 0; j < columnOrder.length; j++) {
                const cell = createCellContent(row, columnOrder[j]);
                tr.appendChild(cell);
            }

            tbody.appendChild(tr);
        }

        DashboardCommon.debugLog('Rendered ' + filteredData.length + ' rows', 'success', 'SHIP');
    }

    /**
     * Open shipment in Fishbowl
     * @param {string} shipNum - Ship number
     */
    function openShip(shipNum) {
        openModule("Shipping", shipNum);
    }

    /**
     * Open order in Fishbowl
     * @param {string} orderNum - Order number
     * @param {number} orderTypeId - Order type ID
     */
    function openOrder(orderNum, orderTypeId) {
        if (orderTypeId === 10) {
            openModule("Purchase Order", orderNum);
        } else if (orderTypeId === 20) {
            openModule("Sales Order", orderNum);
        } else if (orderTypeId === 30) {
            openModule("Work Order", orderNum);
        } else if (orderTypeId === 40) {
            openModule("Transfer Order", orderNum);
        }
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
