'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class WaterMeterControllerDriver extends yoLinkDriver
{

	/**
 * onInit is called when the driver is initialized.
 */
	async onInit()
	{
		this.deviceType = 'WaterMeterController';
		this.homey.app.updateLog('WaterMeterController has been initialized');
	}

};
