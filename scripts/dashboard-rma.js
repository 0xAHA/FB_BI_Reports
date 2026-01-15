/**
 * RMA Orders Dashboard Module
 * Displays open RMA orders with filtering, sorting, and click-through
 */

const ReportRMA = (function() {
    'use strict';

    // Private variables
    let containerId = '';
    let allData = [];
    let filteredData = [];
    let sortColumn = 'dateexpires';
    let sortDirection = 'asc';

    /**
     * Initialize the RMA Orders tile
     * @param {string} container - ID of the container element
     */
    function init(container) {
        containerId = container;
        DashboardCommon.debugLog('Initializing RMA Orders module', 'info', 'RMA');
        setupUI();
        loadData();
    }

    /**
     * Setup the UI structure
     */
    function setupUI() {
        const container = document.getElementById(containerId);
        if (!container) {
            DashboardCommon.debugLog('Container not found: ' + containerId, 'error', 'RMA');
            return;
        }

        container.innerHTML = `
            <div class="tile-header">
                <div>
                    <h2 class="tile-title">Open RMA Orders</h2>
                </div>
                <div class="tile-controls">
                    <span id="${containerId}-filterInfo" class="filter-info" style="display: none;"></span>
                    <button class="btn" onclick="ReportRMA.clearFilters()">Clear Filters</button>
                    <button class="btn btn-primary" onclick="ReportRMA.refresh()">Refresh</button>
                </div>
            </div>
            <div class="tile-table-container">
                <table class="tile-table">
                    <thead>
                        <tr>
                            <th data-column="scheduleindicator" class="schedule-col" onclick="ReportRMA.sortTable('dateexpires')" title="Schedule Status">
                                <svg class="clock-icon" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z"/>
                                </svg>
                            </th>
                            <th data-column="statusname" onclick="ReportRMA.sortTable('statusname')">Status <span class="sort-icon">⇅</span></th>
                            <th data-column="issue" onclick="ReportRMA.sortTable('issue')">Issue <span class="sort-icon">⇅</span></th>
                            <th data-column="type" onclick="ReportRMA.sortTable('type')">Type <span class="sort-icon">⇅</span></th>
                            <th data-column="num" onclick="ReportRMA.sortTable('num')">RMA # <span class="sort-icon">⇅</span></th>
                            <th data-column="product" onclick="ReportRMA.sortTable('product')">Product <span class="sort-icon">⇅</span></th>
                            <th data-column="qty" onclick="ReportRMA.sortTable('qty')">Qty <span class="sort-icon">⇅</span></th>
                            <th data-column="customername" onclick="ReportRMA.sortTable('customername')">Customer <span class="sort-icon">⇅</span></th>
                            <th data-column="datecreated" onclick="ReportRMA.sortTable('datecreated')">Date Created <span class="sort-icon">⇅</span></th>
                            <th data-column="dateexpires" onclick="ReportRMA.sortTable('dateexpires')">Date Expires <span class="sort-icon">⇅</span></th>
                        </tr>
                        <tr class="filter-row">
                            <td data-filter="scheduleindicator"></td>
                            <td><input type="text" data-filter="statusname" placeholder="Filter..." onkeyup="ReportRMA.applyFilters()"></td>
                            <td><input type="text" data-filter="issue" placeholder="Filter..." onkeyup="ReportRMA.applyFilters()"></td>
                            <td><input type="text" data-filter="type" placeholder="Filter..." onkeyup="ReportRMA.applyFilters()"></td>
                            <td><input type="text" data-filter="num" placeholder="Filter..." onkeyup="ReportRMA.applyFilters()"></td>
                            <td><input type="text" data-filter="product" placeholder="Filter..." onkeyup="ReportRMA.applyFilters()"></td>
                            <td><input type="text" data-filter="qty" placeholder="Filter..." onkeyup="ReportRMA.applyFilters()"></td>
                            <td><input type="text" data-filter="customername" placeholder="Filter..." onkeyup="ReportRMA.applyFilters()"></td>
                            <td><input type="text" data-filter="datecreated" placeholder="Filter..." onkeyup="ReportRMA.applyFilters()"></td>
                            <td><input type="text" data-filter="dateexpires" placeholder="Filter..." onkeyup="ReportRMA.applyFilters()"></td>
                        </tr>
                    </thead>
                    <tbody id="${containerId}-tableBody">
                        <tr>
                            <td colspan="10" style="text-align: center; padding: 20px; color: #94a3b8;">Loading...</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    /**
     * Load RMA orders data
     */
    function loadData() {
        DashboardCommon.debugLog('Starting data load...', 'info', 'RMA');

        try {
            const currentUser = JSON.parse(getUser());
            const userId = currentUser.id;
            DashboardCommon.debugLog('Current user ID: ' + userId, 'info', 'RMA');

            const query =
                "SELECT " +
                "    Rma.id AS rmaId, " +
                "    Rma.num AS num, " +
                "    Rma.dateCreated AS dateCreated, " +
                "    Rma.dateExpires AS dateExpires, " +
                "    RmaStatus.Name AS statusName, " +
                "    Customer.Name AS customerName, " +
                "    RmaItem.id AS rmaItemId, " +
                "    RmaItem.typeId AS typeId, " +
                "    RmaItem.issueId AS issueId, " +
                "    RmaItemType.Name AS typeName, " +
                "    RmaItem.productId AS productId, " +
                "    Product.num AS productNum, " +
                "    RmaItem.qty AS qty " +
                "FROM Rma " +
                "LEFT JOIN RmaStatus ON Rma.statusId = RmaStatus.Id " +
                "LEFT JOIN Customer ON Rma.customerId = Customer.id " +
                "LEFT JOIN RmaItem ON Rma.id = RmaItem.rmaId " +
                "LEFT JOIN RmaItemType ON RmaItem.typeId = RmaItemType.Id " +
                "LEFT JOIN Product ON RmaItem.productId = Product.id " +
                "INNER JOIN UserToLG ON Rma.locationGroupId = UserToLG.LocationGroupId AND UserToLG.UserId = " + userId + " " +
                "WHERE Rma.statusId = 10 " +
                "ORDER BY Rma.dateExpires ASC";

            DashboardCommon.debugLog('Executing SQL query...', 'query', 'RMA');

            const queryResult = runQuery(query);
            const result = JSON.parse(queryResult);

            DashboardCommon.debugLog('Parsed ' + result.length + ' records', 'success', 'RMA');

            // Group by RMA ID + Type ID + Issue ID
            const grouped = {};
            for (let i = 0; i < result.length; i++) {
                const row = result[i];
                const key = row.rmaid + '_' + row.typeid + '_' + row.issueid;

                // Map issueId to issue name
                let issueName = '';
                if (row.issueid === null || row.issueid === undefined) issueName = '-';
                else if (row.issueid === 2) issueName = 'DOA';
                else if (row.issueid === 3) issueName = 'Warranty';

                if (!grouped[key]) {
                    grouped[key] = {
                        rmaid: row.rmaid,
                        num: row.num,
                        datecreated: row.datecreated,
                        dateexpires: row.dateexpires,
                        statusname: row.statusname,
                        customername: row.customername,
                        typeid: row.typeid,
                        typename: row.typename,
                        type: row.typename || '',
                        issueid: row.issueid,
                        issue: issueName,
                        products: [],
                        totalQty: 0
                    };
                }

                grouped[key].products.push({
                    productid: row.productid,
                    productnum: row.productnum,
                    qty: parseFloat(row.qty) || 0
                });
                grouped[key].totalQty += parseFloat(row.qty) || 0;
            }

            // Convert grouped object to array and determine product display
            const processedData = [];
            for (let key in grouped) {
                const group = grouped[key];

                if (group.products.length === 1) {
                    group.product = group.products[0].productnum || '';
                    group.qty = group.products[0].qty;
                } else if (group.products.length > 1) {
                    group.product = 'Multiple';
                    group.qty = group.totalQty;
                } else {
                    group.product = '';
                    group.qty = 0;
                }

                processedData.push(group);
            }

            DashboardCommon.debugLog('Processed into ' + processedData.length + ' grouped records', 'success', 'RMA');

            allData = processedData;
            applyFilters();

            DashboardCommon.debugLog('Load complete: ' + filteredData.length + ' RMA orders displayed', 'success', 'RMA');

        } catch (error) {
            DashboardCommon.debugLog('ERROR: ' + error.message, 'error', 'RMA');
            console.error('Error loading RMA orders:', error);
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
            filterInfo.textContent = 'Showing ' + filteredData.length + ' of ' + allData.length + ' RMA orders';
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
            const scheduleStatus = DashboardCommon.getScheduleStatus(row.dateexpires);
            return DashboardCommon.createScheduleIndicator(scheduleStatus, row.dateexpires);
        } else if (column === 'statusname') {
            let statusClass = 'status-badge';
            if (row.statusname === 'Open') statusClass += ' status-open';
            else if (row.statusname === 'Fulfilled') statusClass += ' status-fulfilled';
            else if (row.statusname === 'Expired') statusClass += ' status-expired';
            const badge = document.createElement('span');
            badge.className = statusClass;
            badge.textContent = row.statusname || '';
            td.appendChild(badge);
            td.title = row.statusname || '';
        } else if (column === 'issue') {
            td.textContent = row.issue || '';
            td.title = row.issue || '';
        } else if (column === 'type') {
            td.textContent = row.type || '';
            td.title = row.type || '';
        } else if (column === 'num') {
            const rmaLink = document.createElement('a');
            rmaLink.href = '#';
            rmaLink.className = 'order-link';
            rmaLink.textContent = row.num;
            rmaLink.onclick = function(e) {
                e.preventDefault();
                openRMA(row.num);
                return false;
            };
            td.appendChild(rmaLink);
            td.title = row.num;
        } else if (column === 'product' || column === 'qty') {
            td.textContent = row[column] || '';
            td.title = row[column] || '';
        } else if (column === 'customername') {
            td.textContent = row.customername || '';
            td.title = row.customername || '';
        } else if (column === 'datecreated' || column === 'dateexpires') {
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
            tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 20px; color: #94a3b8;">No RMA orders found</td></tr>';
            return;
        }

        const columnOrder = ['scheduleindicator', 'statusname', 'issue', 'type', 'num', 'product', 'qty', 'customername', 'datecreated', 'dateexpires'];

        for (let i = 0; i < filteredData.length; i++) {
            const row = filteredData[i];
            const tr = document.createElement('tr');

            for (let j = 0; j < columnOrder.length; j++) {
                const cell = createCellContent(row, columnOrder[j]);
                tr.appendChild(cell);
            }

            tbody.appendChild(tr);
        }

        DashboardCommon.debugLog('Rendered ' + filteredData.length + ' rows', 'success', 'RMA');
    }

    /**
     * Open RMA order in Fishbowl
     * @param {string} orderNum - Order number
     */
    function openRMA(orderNum) {
        openModule("RMA", orderNum);
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
