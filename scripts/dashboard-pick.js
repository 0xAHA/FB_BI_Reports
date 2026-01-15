/**
 * Items To Be Picked Dashboard Module
 * Displays pick items with availability status, filtering, sorting, and click-through
 */

const ReportPICK = (function() {
    'use strict';

    // Private variables
    let containerId = '';
    let allData = [];
    let filteredData = [];
    let sortColumn = 'datescheduled';
    let sortDirection = 'asc';

    /**
     * Initialize the Picks tile
     * @param {string} container - ID of the container element
     */
    function init(container) {
        containerId = container;
        DashboardCommon.debugLog('Initializing Picks module', 'info', 'PICK');
        setupUI();
        loadData();
    }

    /**
     * Setup the UI structure
     */
    function setupUI() {
        const container = document.getElementById(containerId);
        if (!container) {
            DashboardCommon.debugLog('Container not found: ' + containerId, 'error', 'PICK');
            return;
        }

        container.innerHTML = `
            <div class="tile-header">
                <div>
                    <h2 class="tile-title">Items To Be Picked</h2>
                </div>
                <div class="tile-controls">
                    <span id="${containerId}-filterInfo" class="filter-info" style="display: none;"></span>
                    <button class="btn" onclick="ReportPICK.clearFilters()">Clear Filters</button>
                    <button class="btn btn-primary" onclick="ReportPICK.refresh()">Refresh</button>
                </div>
            </div>
            <div class="tile-table-container">
                <table class="tile-table">
                    <thead>
                        <tr>
                            <th data-column="scheduleindicator" class="schedule-col" onclick="ReportPICK.sortTable('datescheduled')" title="Schedule Status">
                                <svg class="clock-icon" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z"/>
                                </svg>
                            </th>
                            <th data-column="availabilitystatus" class="narrow-col" onclick="ReportPICK.sortTable('availabilitystatus')" title="Availability Status">
                                <svg class="availability-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <path d="M9 12l2 2 4-4"/>
                                </svg>
                                <span class="sort-icon">⇅</span>
                            </th>
                            <th data-column="num" onclick="ReportPICK.sortTable('num')">Number <span class="sort-icon">⇅</span></th>
                            <th data-column="statusname" onclick="ReportPICK.sortTable('statusname')">Status <span class="sort-icon">⇅</span></th>
                            <th data-column="priorityname" onclick="ReportPICK.sortTable('priorityname')">Priority <span class="sort-icon">⇅</span></th>
                            <th data-column="datescheduled" onclick="ReportPICK.sortTable('datescheduled')">Scheduled Date <span class="sort-icon">⇅</span></th>
                            <th data-column="ordernum" onclick="ReportPICK.sortTable('ordernum')">Order # <span class="sort-icon">⇅</span></th>
                            <th data-column="orderinfo" onclick="ReportPICK.sortTable('orderinfo')">Order Info <span class="sort-icon">⇅</span></th>
                        </tr>
                        <tr class="filter-row">
                            <td data-filter="scheduleindicator"></td>
                            <td><input type="text" data-filter="availabilitystatus" placeholder="Filter..." onkeyup="ReportPICK.applyFilters()"></td>
                            <td><input type="text" data-filter="num" placeholder="Filter..." onkeyup="ReportPICK.applyFilters()"></td>
                            <td><input type="text" data-filter="statusname" placeholder="Filter..." onkeyup="ReportPICK.applyFilters()"></td>
                            <td><input type="text" data-filter="priorityname" placeholder="Filter..." onkeyup="ReportPICK.applyFilters()"></td>
                            <td><input type="text" data-filter="datescheduled" placeholder="Filter..." onkeyup="ReportPICK.applyFilters()"></td>
                            <td><input type="text" data-filter="ordernum" placeholder="Filter..." onkeyup="ReportPICK.applyFilters()"></td>
                            <td><input type="text" data-filter="orderinfo" placeholder="Filter..." onkeyup="ReportPICK.applyFilters()"></td>
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
     * Load pick data
     */
    function loadData() {
        DashboardCommon.debugLog('Starting data load...', 'info', 'PICK');

        try {
            const currentUser = JSON.parse(getUser());
            const userId = currentUser.id;
            DashboardCommon.debugLog('Current user ID: ' + userId, 'info', 'PICK');

            // Complex query to get pick data with availability calculation
            const query =
                "SELECT " +
                "    Pick.Id AS id, " +
                "    Pick.Num AS num, " +
                "    Pick.DateScheduled AS dateScheduled, " +
                "    Pick.StatusId AS statusId, " +
                "    PickStatus.Name AS statusName, " +
                "    Priority.Name AS priorityName, " +
                "    COALESCE( " +
                "        (SELECT PickItem.OrderTypeId FROM PickItem " +
                "         WHERE PickItem.PickId = Pick.Id LIMIT 1), " +
                "        0 " +
                "    ) AS orderTypeId, " +
                "    COALESCE( " +
                "        (SELECT So.Num FROM PickItem " +
                "         JOIN SoItem ON PickItem.SoItemId = SoItem.Id " +
                "         JOIN So ON SoItem.SoId = So.Id " +
                "         WHERE PickItem.PickId = Pick.Id AND PickItem.OrderTypeId = 20 LIMIT 1), " +
                "        (SELECT Po.Num FROM PickItem " +
                "         JOIN PoItem ON PickItem.PoItemId = PoItem.Id " +
                "         JOIN Po ON PoItem.PoId = Po.Id " +
                "         WHERE PickItem.PickId = Pick.Id AND PickItem.OrderTypeId = 10 LIMIT 1), " +
                "        (SELECT Wo.Num FROM PickItem " +
                "         JOIN WoItem ON PickItem.WoItemId = WoItem.Id " +
                "         JOIN Wo ON WoItem.WoId = Wo.Id " +
                "         WHERE PickItem.PickId = Pick.Id AND PickItem.OrderTypeId = 30 LIMIT 1), " +
                "        (SELECT Xo.Num FROM PickItem " +
                "         JOIN XoItem ON PickItem.XoItemId = XoItem.Id " +
                "         JOIN Xo ON XoItem.XoId = Xo.Id " +
                "         WHERE PickItem.PickId = Pick.Id AND PickItem.OrderTypeId = 40 LIMIT 1), " +
                "        'N/A' " +
                "    ) AS orderNum, " +
                "    COALESCE( " +
                "        (SELECT Customer.Name FROM PickItem " +
                "         JOIN SoItem ON PickItem.SoItemId = SoItem.Id " +
                "         JOIN So ON SoItem.SoId = So.Id " +
                "         JOIN Customer ON So.CustomerId = Customer.Id " +
                "         WHERE PickItem.PickId = Pick.Id AND PickItem.OrderTypeId = 20 LIMIT 1), " +
                "        (SELECT Vendor.Name FROM PickItem " +
                "         JOIN PoItem ON PickItem.PoItemId = PoItem.Id " +
                "         JOIN Po ON PoItem.PoId = Po.Id " +
                "         JOIN Vendor ON Po.VendorId = Vendor.Id " +
                "         WHERE PickItem.PickId = Pick.Id AND PickItem.OrderTypeId = 10 LIMIT 1), " +
                "        (SELECT LocationGroup.Name FROM PickItem " +
                "         JOIN WoItem ON PickItem.WoItemId = WoItem.Id " +
                "         JOIN Wo ON WoItem.WoId = Wo.Id " +
                "         JOIN LocationGroup ON Wo.LocationGroupId = LocationGroup.Id " +
                "         WHERE PickItem.PickId = Pick.Id AND PickItem.OrderTypeId = 30 LIMIT 1), " +
                "        (SELECT LocationGroup.Name FROM PickItem " +
                "         JOIN XoItem ON PickItem.XoItemId = XoItem.Id " +
                "         JOIN Xo ON XoItem.XoId = Xo.Id " +
                "         JOIN LocationGroup ON Xo.ShipToLgId = LocationGroup.Id " +
                "         WHERE PickItem.PickId = Pick.Id AND PickItem.OrderTypeId = 40 LIMIT 1), " +
                "        'N/A' " +
                "    ) AS orderInfo, " +
                "    ( " +
                "        SELECT COUNT(*) " +
                "        FROM PickItem " +
                "        WHERE PickItem.PickId = Pick.Id " +
                "        AND PickItem.StatusId < 40 " +
                "        AND (PickItem.StatusId = 30 " +
                "             OR (PickItem.StatusId IN (10, 11, 20) " +
                "                 AND (COALESCE((SELECT qty FROM qtyonhand WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0) " +
                "                      - COALESCE((SELECT qty FROM qtycommitted WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0) " +
                "                      - COALESCE((SELECT qty FROM qtynotavailabletopick WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0)) >= PickItem.Qty)) " +
                "    ) AS fullItems, " +
                "    ( " +
                "        SELECT COUNT(*) " +
                "        FROM PickItem " +
                "        WHERE PickItem.PickId = Pick.Id " +
                "        AND PickItem.StatusId IN (10, 11, 20) " +
                "        AND (COALESCE((SELECT qty FROM qtyonhand WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0) " +
                "             - COALESCE((SELECT qty FROM qtycommitted WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0) " +
                "             - COALESCE((SELECT qty FROM qtynotavailabletopick WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0)) > 0 " +
                "        AND (COALESCE((SELECT qty FROM qtyonhand WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0) " +
                "             - COALESCE((SELECT qty FROM qtycommitted WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0) " +
                "             - COALESCE((SELECT qty FROM qtynotavailabletopick WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0)) < PickItem.Qty " +
                "    ) AS partialItems, " +
                "    ( " +
                "        SELECT COUNT(*) " +
                "        FROM PickItem " +
                "        WHERE PickItem.PickId = Pick.Id " +
                "        AND PickItem.StatusId < 40 " +
                "        AND (PickItem.StatusId IN (5, 6) " +
                "             OR (PickItem.StatusId IN (10, 11, 20) " +
                "                 AND (COALESCE((SELECT qty FROM qtyonhand WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0) " +
                "                      - COALESCE((SELECT qty FROM qtycommitted WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0) " +
                "                      - COALESCE((SELECT qty FROM qtynotavailabletopick WHERE partId = PickItem.PartId AND locationGroupId = Pick.LocationGroupId), 0)) <= 0)) " +
                "    ) AS noneItems, " +
                "    ( " +
                "        SELECT COUNT(*) FROM PickItem WHERE PickItem.PickId = Pick.Id AND PickItem.StatusId < 40 " +
                "    ) AS pendingItems, " +
                "    ( " +
                "        SELECT COUNT(*) FROM PickItem WHERE PickItem.PickId = Pick.Id AND PickItem.StatusId = 30 " +
                "    ) AS committedItems " +
                "FROM Pick " +
                "LEFT JOIN PickStatus ON Pick.StatusId = PickStatus.Id " +
                "LEFT JOIN Priority ON Pick.Priority = Priority.Id " +
                "INNER JOIN UserToLG ON Pick.LocationGroupId = UserToLG.LocationGroupId AND UserToLG.UserId = " + userId + " " +
                "WHERE Pick.StatusId < 40 " +
                "ORDER BY Pick.DateScheduled ASC";

            DashboardCommon.debugLog('Executing SQL query...', 'query', 'PICK');

            const queryResult = runQuery(query);
            const result = JSON.parse(queryResult);

            DashboardCommon.debugLog('Parsed ' + result.length + ' records', 'success', 'PICK');

            // Add formatted order number with prefix and calculate availability status
            for (let i = 0; i < result.length; i++) {
                let orderPrefix = '';
                if (result[i].ordertypeid === 10) orderPrefix = 'PO-';
                else if (result[i].ordertypeid === 20) orderPrefix = 'SO-';
                else if (result[i].ordertypeid === 30) orderPrefix = 'WO-';
                else if (result[i].ordertypeid === 40) orderPrefix = 'TO-';
                result[i].ordernumdisplay = orderPrefix + (result[i].ordernum || '');

                // Calculate availability status: green/orange/red/committed
                const fullItems = result[i].fullitems || 0;
                const partialItems = result[i].partialitems || 0;
                const noneItems = result[i].noneitems || 0;
                const pendingItems = result[i].pendingitems || 0;
                const committedItems = result[i].committeditems || 0;

                if (pendingItems === 0) {
                    result[i].availabilitystatus = 'gray';
                } else if (committedItems === pendingItems && pendingItems > 0) {
                    result[i].availabilitystatus = 'committed';
                } else if (fullItems === pendingItems) {
                    result[i].availabilitystatus = 'green';
                } else if (noneItems === pendingItems) {
                    result[i].availabilitystatus = 'red';
                } else {
                    result[i].availabilitystatus = 'orange';
                }
            }

            allData = result;
            applyFilters();

            DashboardCommon.debugLog('Load complete: ' + filteredData.length + ' picks displayed', 'success', 'PICK');

        } catch (error) {
            DashboardCommon.debugLog('ERROR: ' + error.message, 'error', 'PICK');
            console.error('Error loading picks:', error);
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
                    const dataField = filterKey === 'ordernum' ? 'ordernumdisplay' : filterKey;
                    const cellValue = (row[dataField] || '').toString().toLowerCase();
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
            filterInfo.textContent = 'Showing ' + filteredData.length + ' of ' + allData.length + ' picks';
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
            const sortField = sortColumn === 'ordernum' ? 'ordernumdisplay' : sortColumn;
            const aVal = a[sortField] || '';
            const bVal = b[sortField] || '';

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
        } else if (column === 'availabilitystatus') {
            return DashboardCommon.createAvailabilityIndicator(row);
        } else if (column === 'num') {
            const pickLink = document.createElement('a');
            pickLink.href = '#';
            pickLink.className = 'order-link';
            pickLink.textContent = row.num;
            pickLink.onclick = function(e) {
                e.preventDefault();
                openPick(row.num);
                return false;
            };
            td.appendChild(pickLink);
            td.title = row.num;
        } else if (column === 'statusname') {
            let statusClass = 'status-badge';
            if (row.statusname === 'Entered') statusClass += ' status-estimate';
            else if (row.statusname === 'Started') statusClass += ' status-inprogress';
            else if (row.statusname === 'Committed') statusClass += ' status-issued';
            else if (row.statusname === 'Finished') statusClass += ' status-issued';
            const badge = document.createElement('span');
            badge.className = statusClass;
            badge.textContent = row.statusname || '';
            td.appendChild(badge);
            td.title = row.statusname || '';
        } else if (column === 'priorityname') {
            td.textContent = row.priorityname || '';
            td.title = row.priorityname || '';
        } else if (column === 'datescheduled') {
            td.textContent = DashboardCommon.formatDate(row.datescheduled);
            td.title = DashboardCommon.formatDate(row.datescheduled);
        } else if (column === 'ordernum') {
            td.textContent = row.ordernumdisplay || '';
            td.title = row.ordernumdisplay || '';
        } else if (column === 'orderinfo') {
            td.textContent = row.orderinfo || '';
            td.title = row.orderinfo || '';
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
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #94a3b8;">No picks found</td></tr>';
            return;
        }

        const columnOrder = ['scheduleindicator', 'availabilitystatus', 'num', 'statusname', 'priorityname', 'datescheduled', 'ordernum', 'orderinfo'];

        for (let i = 0; i < filteredData.length; i++) {
            const row = filteredData[i];
            const tr = document.createElement('tr');

            for (let j = 0; j < columnOrder.length; j++) {
                const cell = createCellContent(row, columnOrder[j]);
                tr.appendChild(cell);
            }

            tbody.appendChild(tr);
        }

        DashboardCommon.debugLog('Rendered ' + filteredData.length + ' rows', 'success', 'PICK');
    }

    /**
     * Open pick in Fishbowl
     * @param {string} pickNum - Pick number
     */
    function openPick(pickNum) {
        openModule("Picking", pickNum);
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
