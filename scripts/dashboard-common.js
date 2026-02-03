/**
 * Dashboard Common Utilities
 * Shared functions used across all dashboard tiles
 */

const DashboardCommon = (function() {
    'use strict';

    // Get Fishbowl properties
    const FB_DATE_FORMAT = getProperty('DateFormatShort', 'dd/MM/yyyy');
    const BI_SHOW_DEBUG_PROP = getProperty('BI_SHOW_DEBUG', 'false');
    const DEBUG_MODE = BI_SHOW_DEBUG_PROP === 'true' || BI_SHOW_DEBUG_PROP === true;

    /**
     * Format date from SQL format to display format
     * @param {string} dateStr - Date string in YYYY-MM-DD HH:mm:ss format
     * @returns {string} Formatted date string
     */
    function formatDate(dateStr) {
        if (!dateStr) return '';
        var parts = dateStr.split(' ')[0].split('-');
        var year = parts[0];
        var month = parts[1];
        var day = parts[2];

        // Use the system date format setting
        // FB_DATE_FORMAT uses Java SimpleDateFormat: dd/MM/yyyy or MM/dd/yyyy
        if (FB_DATE_FORMAT.toLowerCase().indexOf('mm/dd') === 0) {
            return month + '/' + day + '/' + year;
        } else {
            return day + '/' + month + '/' + year;
        }
    }

    /**
     * Get schedule status color for indicator
     * @param {string} dateStr - Date string in SQL format
     * @returns {string} Color code: 'red', 'orange', 'blue', or ''
     */
    function getScheduleStatus(dateStr) {
        if (!dateStr) return '';

        // Parse date from SQL format (YYYY-MM-DD HH:mm:ss)
        var dateParts = dateStr.split(' ')[0].split('-');
        var schedDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
        schedDate.setHours(0, 0, 0, 0);

        var today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if today
        if (schedDate.getTime() === today.getTime()) {
            return 'orange';
        }

        // Check if past
        if (schedDate < today) {
            return 'red';
        }

        // Check if within this calendar week (Sunday to Saturday)
        var todayDay = today.getDay(); // 0 = Sunday, 6 = Saturday
        var weekStart = new Date(today);
        weekStart.setDate(today.getDate() - todayDay);
        var weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        if (schedDate >= weekStart && schedDate <= weekEnd) {
            return 'blue';
        }

        return '';
    }

    /**
     * Get status title for availability tooltip (for Picks, RMAs)
     * @param {string} status - Status code
     * @param {number} fullItems - Count of fully available items
     * @param {number} partialItems - Count of partially available items
     * @param {number} noneItems - Count of unavailable items
     * @param {number} pendingItems - Count of pending items
     * @returns {string} Tooltip text
     */
    function getStatusTitle(status, fullItems, partialItems, noneItems, pendingItems) {
        if (status === 'committed') {
            return 'All items committed (' + pendingItems + ' items)';
        } else if (status === 'green') {
            return 'All pending items available (' + fullItems + '/' + pendingItems + ')';
        } else if (status === 'red') {
            return 'No pending items available (0/' + pendingItems + ')';
        } else if (status === 'orange') {
            return 'Partially available (' + fullItems + ' full, ' + partialItems + ' partial, ' + noneItems + ' none of ' + pendingItems + ' pending)';
        } else {
            return 'No pending items (all finished)';
        }
    }

    /**
     * Create schedule indicator SVG icon
     * @param {string} scheduleStatus - Color status: 'red', 'orange', 'blue'
     * @param {string} dateStr - Original date string for title
     * @returns {HTMLElement} SVG element or empty span
     */
    function createScheduleIndicator(scheduleStatus, dateStr) {
        var td = document.createElement('td');
        td.style.textAlign = 'center';

        if (scheduleStatus) {
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'clock-icon');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'currentColor');
            svg.style.width = '20px';
            svg.style.height = '20px';
            if (scheduleStatus === 'blue') svg.style.color = '#2d9cdb';
            else if (scheduleStatus === 'orange') svg.style.color = '#f59e0b';
            else if (scheduleStatus === 'red') svg.style.color = '#ef4444';

            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 10.414V7a1 1 0 10-2 0v6a1 1 0 00.293.707l3 3a1 1 0 001.414-1.414L13 12.414z');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '1.8');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(path);
            td.appendChild(svg);

            if (scheduleStatus === 'orange') td.title = 'Scheduled for today';
            else if (scheduleStatus === 'red') td.title = 'Past due';
            else if (scheduleStatus === 'blue') td.title = 'Scheduled this week';
        }

        return td;
    }

    /**
     * Create availability status indicator (for Picks, RMAs)
     * @param {object} row - Data row containing availability status
     * @returns {HTMLElement} TD element with status indicator
     */
    function createAvailabilityIndicator(row) {
        var td = document.createElement('td');

        if (row.availabilitystatus === 'committed') {
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'status-icon-padlock');
            svg.setAttribute('viewBox', '0 0 16 16');
            svg.setAttribute('fill', 'currentColor');
            svg.style.color = '#f59e0b';
            svg.setAttribute('title', getStatusTitle(row.availabilitystatus, row.fullitems, row.partialitems, row.noneitems, row.pendingitems));
            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('fill-rule', 'evenodd');
            path.setAttribute('d', 'M5 6.5V4.5a3 3 0 1 1 6 0V6.5h1.5V4.5a4.5 4.5 0 0 0-9 0V6.5H5zM2.5 8A1.5 1.5 0 0 1 4 6.5h8A1.5 1.5 0 0 1 13.5 8v5.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V8zm10 0a.5.5 0 0 0-.5-.5H4a.5.5 0 0 0-.5.5v5.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V8z');
            svg.appendChild(path);
            td.appendChild(svg);
        } else {
            var circle = document.createElement('div');
            circle.className = 'status-circle ' + (row.availabilitystatus || 'gray');
            circle.title = getStatusTitle(row.availabilitystatus, row.fullitems, row.partialitems, row.noneitems, row.pendingitems);
            td.appendChild(circle);
        }

        return td;
    }

    /**
     * Debug logging utility
     * @param {string} message - Log message
     * @param {string} type - Message type: 'info', 'success', 'warning', 'error', 'query'
     * @param {string} tileId - ID of the tile logging the message
     */
    function debugLog(message, type, tileId) {
        if (!DEBUG_MODE) return;

        var logDiv = document.getElementById('debugLog');
        if (!logDiv) return;

        var timestamp = new Date().toLocaleTimeString();

        var placeholder = logDiv.querySelector('[style*="italic"]');
        if (placeholder) {
            logDiv.innerHTML = '';
        }

        var colors = {
            'info': '#60a5fa',
            'success': '#34d399',
            'warning': '#fbbf24',
            'error': '#f87171',
            'query': '#a78bfa'
        };

        var entry = document.createElement('div');
        entry.style.marginBottom = '4px';
        var tilePrefix = tileId ? '[' + tileId + '] ' : '';
        entry.innerHTML = '<span style="color: #64748b;">[' + timestamp + ']</span> ' +
                         '<span style="color: #94a3b8;">' + tilePrefix + '</span>' +
                         '<span style="color: ' + colors[type] + ';">' + message + '</span>';

        logDiv.appendChild(entry);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    /**
     * Clear debug log
     */
    function clearDebugLog() {
        var logDiv = document.getElementById('debugLog');
        if (logDiv) {
            logDiv.innerHTML = '<div style="color: #64748b; font-style: italic;">Log cleared...</div>';
        }
    }

    // Public API
    return {
        DEBUG_MODE: DEBUG_MODE,
        FB_DATE_FORMAT: FB_DATE_FORMAT,
        formatDate: formatDate,
        getScheduleStatus: getScheduleStatus,
        getStatusTitle: getStatusTitle,
        createScheduleIndicator: createScheduleIndicator,
        createAvailabilityIndicator: createAvailabilityIndicator,
        debugLog: debugLog,
        clearDebugLog: clearDebugLog
    };
})();
