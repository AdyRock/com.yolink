'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class MotionSensorDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'MotionSensor';
		this.homey.app.updateLog('MotionSensorDriver has been initialized');
	}

};
