'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class PowerFailDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'PowerFailureAlarm';
		this.homey.app.updateLog('PowerFailDriver has been initialized');
	}
};
