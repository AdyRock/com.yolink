'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class OutletDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'Outlet';
		this.homey.app.updateLog('OutletDriver has been initialized');
	}
};
