'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class LeakSensorDriver extends yoLinkDriver
{

	/**
 * onInit is called when the driver is initialized.
 */
	async onInit()
	{
		this.deviceType = 'LeakSensor';
		this.homey.app.updateLog('LeakSensor has been initialized');
	}

};
